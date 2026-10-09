// Face finder for the portrait pipeline (scripts/content/movies/lib/faces.mts): Apple Vision's face
// detector over each image path given, one JSON line per image on stdout:
//   {"path": "...", "width": 960, "height": 1280, "faces": [{"x": 0, "y": 0, "w": 0, "h": 0, "c": 0.8}]}
// Boxes are in pixels from the top-left. An unreadable image gets "faces": [] and an "error".
import Foundation
import ImageIO
import Vision

func emit(_ object: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
    print(line)
  }
}

for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    emit(["path": path, "faces": [], "error": "unreadable"])
    continue
  }
  let width = Double(image.width)
  let height = Double(image.height)
  let request = VNDetectFaceRectanglesRequest()
  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    emit(["path": path, "width": width, "height": height, "faces": [], "error": "vision"])
    continue
  }
  let faces: [[String: Double]] = (request.results ?? []).map { face in
    let box = face.boundingBox // normalised, origin at the bottom-left
    return ["x": box.minX * width, "y": (1 - box.maxY) * height, "w": box.width * width, "h": box.height * height, "c": Double(face.confidence)]
  }
  emit(["path": path, "width": width, "height": height, "faces": faces])
}
