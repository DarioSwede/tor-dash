import AppKit
import CryptoKit
import EventKit
import Foundation

private let endpoint = URL(string: "https://ohwalxqwtxtlldalsclj.supabase.co/functions/v1/calendar-sync")!
private let publishableKey = "sb_publishable_3QbnisCwm0HdoImcMMu7AA_2zrIevZw"
private let keychainService = "se.tordash.calendar-bridge"
private let keychainAccount = "sync-token"
private let day: TimeInterval = 86_400
private let hkdfInfo = Data("tor-dash-envelope-v1".utf8)
private let hkdfSalt = Data(repeating: 0, count: 32)

struct BridgeEvent: Codable {
    let external_id: String
    let calendar_name: String
    let color: String?
    let title: String
    let start_at: String
    let end_at: String
    let start_date: String
    let end_date: String
    let all_day: Bool
    let location: String?
}

struct CalendarPayload: Codable {
    let window_start: String
    let window_end: String
    let events: [BridgeEvent]
}

struct PublicJWK: Decodable {
    let kty: String
    let crv: String
    let x: String
    let y: String
}

struct DeviceKey: Decodable {
    let id: String
    let public_key_jwk: PublicJWK
}

struct KeyResponse: Decodable {
    let keys: [DeviceKey]
}

struct Envelope: Encodable {
    struct EphemeralKey: Encodable {
        let kty = "EC"
        let crv = "P-256"
        let x: String
        let y: String
    }
    let v = 1
    let alg = "ECDH-P256+HKDF-SHA256+AES-256-GCM"
    let key_id: String
    let epk: EphemeralKey
    let iv: String
    let ciphertext: String
}

struct UploadBody: Encodable {
    let envelopes: [Envelope]
}

enum BridgeError: Error, CustomStringConvertible {
    case calendarAccess
    case missingToken
    case noDeviceKeys
    case invalidKey
    case request(String)

    var description: String {
        switch self {
        case .calendarAccess: return "Kalenderåtkomst saknas. Öppna Systeminställningar → Integritet och säkerhet → Kalendrar."
        case .missingToken: return "Synknyckeln saknas i Nyckelhanteraren."
        case .noDeviceKeys: return "Ingen dashboard-enhet har registrerat en krypteringsnyckel."
        case .invalidKey: return "En registrerad publik nyckel är ogiltig."
        case .request(let message): return "Synkningen misslyckades: \(message)"
        }
    }
}
func requestCalendarAccess(_ store: EKEventStore) async -> Bool {
    if #available(macOS 14.0, *) {
        return (try? await store.requestFullAccessToEvents()) == true
    }
    return await withCheckedContinuation { continuation in
        store.requestAccess(to: .event) { granted, _ in continuation.resume(returning: granted) }
    }
}

func runProcess(_ executable: String, _ arguments: [String]) throws -> Data {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = pipe
    process.standardError = Pipe()
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw BridgeError.missingToken }
    return pipe.fileHandleForReading.readDataToEndOfFile()
}

func readToken() throws -> String {
    let data = try runProcess("/usr/bin/security", [
        "find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w",
    ])
    guard let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          token.count >= 32 else { throw BridgeError.missingToken }
    return token
}

func hexColor(_ color: CGColor?) -> String? {
    guard let color, let converted = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
          let components = converted.components, components.count >= 3 else { return nil }
    return String(format: "#%02X%02X%02X",
                  Int(components[0] * 255), Int(components[1] * 255), Int(components[2] * 255))
}

func localDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "sv_SE")
    formatter.timeZone = TimeZone(identifier: "Europe/Stockholm")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

func collectEvents(store: EKEventStore, start: Date, end: Date) -> [BridgeEvent] {
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let iso = ISO8601DateFormatter()
    return store.events(matching: predicate).compactMap { event in
        guard let eventStart = event.startDate, let eventEnd = event.endDate else { return nil }
        let stableId = "\(event.calendar.calendarIdentifier):\(event.calendarItemIdentifier)"
        let inclusiveEnd = event.isAllDay ? eventEnd.addingTimeInterval(-day) : eventEnd
        return BridgeEvent(
            external_id: stableId,
            calendar_name: event.calendar.title,
            color: hexColor(event.calendar.cgColor),
            title: event.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? event.title : "Kalenderhändelse",
            start_at: iso.string(from: eventStart),
            end_at: iso.string(from: eventEnd),
            start_date: localDate(eventStart),
            end_date: localDate(max(eventStart, inclusiveEnd)),
            all_day: event.isAllDay,
            location: event.location
        )
    }
}

func base64URLDecode(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
}

func base64URLEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func request(_ method: String, token: String, body: Data? = nil) async throws -> Data {
    var request = URLRequest(url: endpoint)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(publishableKey, forHTTPHeaderField: "apikey")
    request.setValue(token, forHTTPHeaderField: "x-calendar-bridge-token")
    request.httpBody = body
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
        throw BridgeError.request("HTTP \(status) \(String(data: data, encoding: .utf8) ?? "")")
    }
    return data
}

func encrypt(_ plaintext: Data, for device: DeviceKey) throws -> Envelope {
    let jwk = device.public_key_jwk
    guard jwk.kty == "EC", jwk.crv == "P-256",
          let x = base64URLDecode(jwk.x), let y = base64URLDecode(jwk.y),
          x.count == 32, y.count == 32 else { throw BridgeError.invalidKey }
    var representation = Data([0x04])
    representation.append(x)
    representation.append(y)
    let recipient = try P256.KeyAgreement.PublicKey(x963Representation: representation)
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let secret = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
    let key = secret.hkdfDerivedSymmetricKey(
        using: SHA256.self, salt: hkdfSalt, sharedInfo: hkdfInfo, outputByteCount: 32
    )
    let sealed = try AES.GCM.seal(plaintext, using: key)
    guard let combined = sealed.ciphertext + sealed.tag as Data?,
          let nonceData = sealed.nonce.withUnsafeBytes({ Data($0) }) as Data? else {
        throw BridgeError.invalidKey
    }
    let epk = ephemeral.publicKey.x963Representation
    return Envelope(
        key_id: device.id,
        epk: .init(x: base64URLEncode(epk.subdata(in: 1..<33)), y: base64URLEncode(epk.subdata(in: 33..<65))),
        iv: nonceData.base64EncodedString(),
        ciphertext: combined.base64EncodedString()
    )
}

@main
struct TorDashCalendarBridge {
    static func main() async {
        do {
            let store = EKEventStore()
            guard await requestCalendarAccess(store) else { throw BridgeError.calendarAccess }
            let now = Date()
            let start = now.addingTimeInterval(-60 * day)
            let end = now.addingTimeInterval(365 * day)
            let events = collectEvents(store: store, start: start, end: end)
            if CommandLine.arguments.contains("--list") {
                print(Set(events.map(\.calendar_name)).sorted().joined(separator: "\n"))
                return
            }
            let token = try readToken()
            let keys = try JSONDecoder().decode(KeyResponse.self, from: await request("GET", token: token)).keys
            guard !keys.isEmpty else { throw BridgeError.noDeviceKeys }
            let payload = CalendarPayload(window_start: localDate(start), window_end: localDate(end), events: events)
            let plaintext = try JSONEncoder().encode(payload)
            let envelopes = try keys.map { try encrypt(plaintext, for: $0) }
            let response = try await request("POST", token: token, body: JSONEncoder().encode(UploadBody(envelopes: envelopes)))
            print("Tor Dash kalender: \(events.count) händelser krypterade för \(envelopes.count) enhet(er). \(String(data: response, encoding: .utf8) ?? "")")
        } catch {
            fputs("Tor Dash kalender: \(error)\n", stderr)
            exit(1)
        }
    }
}
