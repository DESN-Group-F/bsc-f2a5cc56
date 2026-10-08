// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BatteryInventoryService",
    platforms: [.iOS(.v15)],
    products: [.library(name: "BatteryInventoryService", targets: ["BatteryServicePlugin"])],
    dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.5.2")],
    targets: [.target(
        name: "BatteryServicePlugin",
        dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")],
        path: "ios/Sources/BatteryServicePlugin",
        linkerSettings: [.linkedFramework("Security"), .linkedFramework("CryptoKit")]
    )]
)
