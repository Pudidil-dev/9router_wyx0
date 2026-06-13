import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0WQAAAAASUVORK5CYII=";
const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0fHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAVEAEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwEf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwEf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyFf/9k=";

describe("CodeBuddy image MIME normalization", () => {
  it("rewrites mismatched data URI MIME types based on image bytes", () => {
    const executor = new DefaultExecutor("codebuddy");
    const transformed = executor.transformRequest("codebuddy/model", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "check image" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${PNG_BASE64}`,
                detail: "auto",
              },
            },
          ],
        },
      ],
    });

    const imagePart = transformed.messages[1].content[1];
    expect(imagePart.image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(imagePart.image_url.detail).toBe("auto");
  });

  it("keeps already-correct MIME types unchanged", () => {
    const executor = new DefaultExecutor("codebuddy");
    const transformed = executor.transformRequest("codebuddy/model", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${JPEG_BASE64}`,
              },
            },
          ],
        },
      ],
    });

    const imagePart = transformed.messages[1].content[0];
    expect(imagePart.image_url.url).toBe(`data:image/jpeg;base64,${JPEG_BASE64}`);
  });
});
