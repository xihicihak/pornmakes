import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import config from "@/lib/config";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id && !session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized. Please sign in to upload images." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No valid image file provided" }, { status: 400 });
    }

    // 1. File size limit: 10MB
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size && file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Image file exceeds 10MB limit." }, { status: 400 });
    }

    // 2. MIME type whitelist validation
    const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const mimeType = (file.type || "image/png").toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: "Only image files (JPEG, PNG, WebP, GIF) are allowed." }, { status: 400 });
    }

    // 3. Filename sanitization (prevent path traversal)
    const rawName = file.name || "reference.png";
    const sanitizedFilename = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-64);

    const comfyApiUrl = process.env.COMFYUI_API_URL || config.ai.comfyui.apiUrl;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. If ComfyUI is configured, attempt uploading directly to ComfyUI /upload/image
    if (comfyApiUrl) {
      try {
        const comfyFormData = new FormData();
        const blob = new Blob([buffer], { type: mimeType });
        comfyFormData.append("image", blob, sanitizedFilename);
        comfyFormData.append("overwrite", "true");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const comfyRes = await fetch(`${comfyApiUrl}/upload/image`, {
          method: "POST",
          body: comfyFormData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (comfyRes.ok) {
          const comfyData = await comfyRes.json();
          return NextResponse.json({
            success: true,
            url: comfyData.name,
            filename: comfyData.name,
            source: "comfyui",
          });
        }
      } catch (comfyErr) {
        console.warn("[UPLOAD] Could not upload directly to ComfyUI:", comfyErr.message);
      }
    }

    // 5. Fallback: Base64 Data URL (self-contained, works with Wan 2.2 pipelines & previews)
    const base64Data = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    return NextResponse.json({
      success: true,
      url: dataUrl,
      filename: sanitizedFilename,
      source: "data_url",
    });
  } catch (error) {
    console.error("[UPLOAD_ERROR]", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}
