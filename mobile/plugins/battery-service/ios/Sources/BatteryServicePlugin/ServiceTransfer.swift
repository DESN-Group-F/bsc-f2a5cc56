import Foundation

struct ServiceTransferResponse {
    let response: HTTPURLResponse
    let bytes: Data
}

/** Ephemeral, bounded transport with no cookie jar, cache or redirects. */
final class ServiceTransfer: NSObject, URLSessionDataDelegate {
    private let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Result<ServiceTransferResponse, ServiceFailure>?
    private var response: HTTPURLResponse?
    private var bytes = Data()
    private var session: URLSession?
    private var task: URLSessionDataTask?

    private func finish(_ value: Result<ServiceTransferResponse, ServiceFailure>) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = value
        lock.unlock()
        semaphore.signal()
    }
    func run(_ request: URLRequest) throws -> ServiceTransferResponse {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 40
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        task = session!.dataTask(with: request)
        task!.resume()
        if semaphore.wait(timeout: .now() + 45) == .timedOut {
            finish(.failure(ServiceFailure(message: "No authoritative response was received. Preserve pending writes and retry their exact captured requests.", code: "NETWORK_UNCERTAIN")))
        }
        task?.cancel()
        session?.invalidateAndCancel()
        lock.lock()
        let completed = result!
        lock.unlock()
        return try completed.get()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(ServiceFailure(message: "The service returned a redirect. No redirect was followed; review the configured origin.", code: "REDIRECT_DENIED")))
        task.cancel()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            finish(.failure(ServiceFailure(message: "The service did not return an HTTP response.", code: "NETWORK_UNCERTAIN")))
            return
        }
        if response.expectedContentLength > Int64(ServicePolicy.maxResponseBytes) {
            completionHandler(.cancel)
            finish(.failure(ServiceFailure(message: "The complete response exceeds the 32 MiB native transport limit. No partial export was returned; narrow its explicit scope.", code: "RESPONSE_TOO_LARGE")))
            return
        }
        self.response = response
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if data.count > ServicePolicy.maxResponseBytes - bytes.count {
            finish(.failure(ServiceFailure(message: "The complete response exceeds the 32 MiB native transport limit. No partial export was returned; narrow its explicit scope.", code: "RESPONSE_TOO_LARGE")))
            dataTask.cancel()
            return
        }
        bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard error == nil, let response = response else {
            finish(.failure(ServiceFailure(message: "No authoritative response was received. Preserve pending writes and retry their exact captured requests.", code: "NETWORK_UNCERTAIN")))
            return
        }
        finish(.success(ServiceTransferResponse(response: response, bytes: bytes)))
    }
}
