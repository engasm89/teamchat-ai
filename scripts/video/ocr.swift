// Prints one JSON line per image: {"path": ..., "text": ...} using macOS Vision text recognition.
// Usage: swift scripts/video/ocr.swift frame1.png frame2.png ...
// Vision returns nothing for small text in a large, sparse frame, so each frame is read whole and
// again as overlapping tiles (a quarter of the width, half the height, 50% overlap): any line shorter
// than half a tile's width lies entirely inside at least one tile.
import Foundation
import Vision
import AppKit

func recognize(_ image: CGImage) -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

for path in CommandLine.arguments.dropFirst() {
    var lines: [String] = []
    if let image = NSImage(contentsOfFile: path),
       let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        lines += recognize(cg)
        let tw = cg.width / 4, th = cg.height / 2
        for y in stride(from: 0, through: cg.height - th, by: th / 2) {
            for x in stride(from: 0, through: cg.width - tw, by: tw / 2) {
                if let tile = cg.cropping(to: CGRect(x: x, y: y, width: tw, height: th)) { lines += recognize(tile) }
            }
        }
    }
    let line = try! JSONSerialization.data(withJSONObject: ["path": path, "text": lines.joined(separator: "\n")])
    print(String(data: line, encoding: .utf8)!)
}
