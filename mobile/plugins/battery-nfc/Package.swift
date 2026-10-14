// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BatteryInventoryNfc",
    platforms: [.iOS(.v15)],
    products: [.library(name: "BatteryInventoryNfc", targets: ["BatteryNfcPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.5.2")
    ],
    targets: [
        .target(
            name: "BatteryNfcPlugin",
            dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")],
            path: "ios/Sources/BatteryNfcPlugin",
            linkerSettings: [.linkedFramework("CoreNFC")]
        )
    ]
)
