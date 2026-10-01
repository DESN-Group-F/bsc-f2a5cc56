// Fictional records for the isolated demonstration inventory. Never seed live data.
export const demoPeople = [
    { id: "demo-staff", name: "Demo Lab Manager", reference: "DEMO-STAFF", role: "staff" },
    { id: "demo-student-1", name: "Demo Student 01", reference: "DEMO-001", role: "borrower" },
    { id: "demo-student-2", name: "Demo Student 02", reference: "DEMO-002", role: "borrower" },
    { id: "demo-student-3", name: "Demo Student 03", reference: "DEMO-003", role: "borrower" },
];
export const demoRooms = [
    { id: "demo-store", name: "Demo Battery Store", building: "Example building" },
    { id: "demo-lab", name: "Demo Teaching Lab", building: "Example building" },
    { id: "demo-workshop", name: "Demo Workshop", building: "Example building" },
];
export const demoBatteries = [
    { id: "BAT-001", name: "Robotics battery pack", chemistry: "LiPo", model: "Example 3S pack", capacityMah: 2200, voltage: 11.1, tagId: "DEMO-TAG-001", ownerId: "demo-staff", homeRoomId: "demo-store" },
    { id: "BAT-002", name: "Robotics battery pack", chemistry: "LiPo", model: "Example 3S pack", capacityMah: 2200, voltage: 11.1, tagId: "DEMO-TAG-002", ownerId: "demo-staff", homeRoomId: "demo-store" },
    { id: "BAT-003", name: "Portable equipment pack", chemistry: "Li-ion", model: "Example equipment pack", capacityMah: 5000, voltage: 7.4, tagId: "DEMO-TAG-003", ownerId: "demo-staff", homeRoomId: "demo-lab" },
    { id: "BAT-004", name: "Student project pack", chemistry: "LiPo", model: "Example 2S pack", capacityMah: 1500, voltage: 7.4, tagId: "DEMO-TAG-004", ownerId: "demo-staff", homeRoomId: "demo-workshop" },
    { id: "BAT-005", name: "Portable equipment pack", chemistry: "Li-ion", model: "Example equipment pack", capacityMah: 3000, voltage: 3.7, tagId: "DEMO-TAG-005", ownerId: "demo-staff", homeRoomId: "demo-lab" },
    { id: "BAT-006", name: "Student project pack", chemistry: "LiPo", model: "Example 4S pack", capacityMah: 4000, voltage: 14.8, tagId: "DEMO-TAG-006", ownerId: "demo-staff", homeRoomId: "demo-store" },
];
