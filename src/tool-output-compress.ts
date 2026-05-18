/** 回传给模型的 tool 结果压缩（trace 仍保留完整输出） */

export function compressToolOutputForModel(toolName: string, output: string): string {
  if (output.startsWith("Error:") || output.startsWith("❌")) {
    return output.slice(0, 400);
  }

  switch (toolName) {
    case "detect_objects": {
      const jsonStart = output.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const j = JSON.parse(output.slice(jsonStart)) as {
            navigation_target?: {
              index?: number;
              hint?: string;
              bearing_deg?: number;
              distance_m?: number;
            };
          };
          const t = j.navigation_target;
          if (t?.bearing_deg != null && t?.distance_m != null) {
            const idx =
              t.index != null ? ` index${t.index}` : t.hint ? ` ${t.hint}` : "";
            return `go_to(bearing_deg=${t.bearing_deg}, distance_m=${t.distance_m})${idx}`;
          }
        } catch {
          /* fall through */
        }
      }
      const bearing = output.match(/bearing_deg=([-\d.]+)/)?.[1];
      const dist = output.match(/distance_m=([\d.]+)/)?.[1];
      if (bearing && dist) {
        const idx = output.match(/\bindex=(\d+)/)?.[1];
        return `go_to(bearing_deg=${bearing}, distance_m=${dist})${idx != null ? ` index${idx}` : ""}`;
      }
      return output.slice(0, 320);
    }
    case "take_photo":
      return output.split("\n")[0]?.trim() || output.slice(0, 120);
    case "go_to":
    case "pick_up":
    case "drop":
      return output.slice(0, 280);
    default:
      return output.slice(0, 500);
  }
}
