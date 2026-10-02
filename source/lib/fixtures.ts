// Fictional records for the isolated demonstration inventory. Never seed live data.
export const demoBatteries = [
    { id: "BAT-001", name: "Robotics battery pack", chemistry: "LiPo", model: "Example 3S pack", capacityMah: 2200, voltage: 11.1, tagId: "DEMO-TAG-001", homeRoomId: "J18-DEMO-ROOM" },
    { id: "BAT-002", name: "Robotics battery pack", chemistry: "LiPo", model: "Example 3S pack", capacityMah: 2200, voltage: 11.1, tagId: "DEMO-TAG-002", homeRoomId: "J18-DEMO-ROOM" },
    { id: "BAT-003", name: "Portable equipment pack", chemistry: "Li-ion", model: "Example equipment pack", capacityMah: 5000, voltage: 7.4, tagId: "DEMO-TAG-003", homeRoomId: "J18-DEMO-WORKSPACE" },
    { id: "BAT-004", name: "Project battery pack", chemistry: "LiPo", model: "Example 2S pack", capacityMah: 1500, voltage: 7.4, tagId: "DEMO-TAG-004", homeRoomId: "J18-DEMO-WORKSPACE" },
    { id: "BAT-005", name: "Portable equipment pack", chemistry: "Li-ion", model: "Example equipment pack", capacityMah: 3000, voltage: 3.7, tagId: "DEMO-TAG-005", homeRoomId: "J18-DEMO-WORKSPACE" },
    { id: "BAT-006", name: "Project battery pack", chemistry: "LiPo", model: "Example 4S pack", capacityMah: 4000, voltage: 14.8, tagId: "DEMO-TAG-006", homeRoomId: null },
].map(b => ({ ...b, homeBuildingId: "J18" }));
