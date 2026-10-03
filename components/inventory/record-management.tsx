"use client";

import { isActiveBattery } from "@/lib/battery-lifecycle";
import { useState } from "react";
import { Plus, Download, Upload, Pencil, Settings2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  formatBatteryAge,
  roomLabel,
  storageRoomLabel,
  downloadExportAttachment,
} from "@/lib/client-utils";
import { isSupportedBuilding, isSelectableRoom } from "@/lib/location-catalog";
import type {
  ImportKind,
  RecordActions,
} from "@/lib/client/inventory-contracts";
import type { Dataset } from "@/lib/domain";

async function downloadRecordList(
  dataset: Dataset,
  search: string,
  kind: ImportKind,
) {
  await downloadExportAttachment(
    { dataset, mode: "records", search, kind },
    "csv",
    `battery-${kind}-${dataset}.csv`,
  );
}

export function RecordManagement({
  data,
  ready,
  onEdit,
  onDetail,
  onImport,
}: RecordActions & {
  onImport: (kind: ImportKind) => void;
}) {
  const [kind, setKind] = useState<ImportKind>("people");
  const [query, setQuery] = useState(""),
    [downloadError, setDownloadError] = useState("");
  const [copyingOwnerId, setCopyingOwnerId] = useState(""),
    [copiedOwnerId, setCopiedOwnerId] = useState(""),
    [copyError, setCopyError] = useState("");
  const admin = data.user.role === "admin";
  const records = (
    kind === "people"
      ? data.people.filter(
          (person) => person.role === "staff" && person.accountId,
        )
      : kind === "buildings"
        ? data.buildings
        : kind === "rooms"
          ? data.rooms
          : data.batteries
  ).filter((record) =>
    Object.values(record).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const people = data.people.filter((person) =>
    records.some((record) => record.id === person.id),
  );
  const buildings = data.buildings.filter((building) =>
    records.some((record) => record.id === building.id),
  );
  const rooms = data.rooms.filter((room) =>
    records.some((record) => record.id === room.id),
  );
  const batteries = data.batteries.filter((battery) =>
    records.some((record) => record.id === battery.id),
  );
  const editorKind =
    kind === "people"
      ? "person"
      : kind === "buildings"
        ? "building"
        : kind === "rooms"
          ? "room"
          : "battery";
  async function copyOwnerId(id: string) {
    setCopyError("");
    setCopiedOwnerId("");
    const person = data.people.find((record) => record.id === id),
      account = data.staffDirectory.find(
        (record) => record.id === person?.accountId,
      );
    if (!account?.active) {
      setCopyError(
        "This owner ID is unavailable for new batteries because its account is inactive or unavailable.",
      );
      return;
    }
    setCopyingOwnerId(id);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(id);
      setCopiedOwnerId(id);
    } catch {
      setCopyError(
        "Could not copy this owner ID. Select the ID below and copy it manually.",
      );
    } finally {
      setCopyingOwnerId("");
    }
  }
  return (
    <section className="inventory-panel">
      <div className="panel-top">
        <Tabs value={kind} onValueChange={(v) => setKind(v as ImportKind)}>
          <TabsList variant="line">
            <TabsTrigger value="people">Staff directory</TabsTrigger>
            <TabsTrigger value="buildings">Buildings</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="batteries">Batteries</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="panel-actions">
          {kind !== "people" && (admin || kind === "batteries") && (
            <>
              <Button
                variant="outline"
                onClick={() => onImport(kind)}
                disabled={!ready}
              >
                <Upload />
                Import CSV
              </Button>
              <Button
                onClick={() => onEdit({ kind: editorKind })}
                disabled={!ready}
              >
                <Plus />
                Register {editorKind}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="table-toolbar">
        <Input
          aria-label="Search managed records"
          placeholder="Search these records…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="ghost" onClick={() => setQuery("")} disabled={!query}>
          Clear filters
        </Button>
        <Button
          variant="outline"
          disabled={!records.length}
          onClick={() =>
            downloadRecordList(data.dataset, query, kind).catch((error) =>
              setDownloadError(error.message),
            )
          }
        >
          <Download size={16} />
          Download filtered list
        </Button>
        <span>{records.length} records</span>
      </div>
      {downloadError && (
        <p className="form-error" role="alert">
          {downloadError}
        </p>
      )}
      {kind === "people" && (
        <>
          {copyError && (
            <p className="form-error" role="alert">
              {copyError}
            </p>
          )}
          {copiedOwnerId && (
            <p className="field-hint" role="status">
              Owner ID copied: {copiedOwnerId}
            </p>
          )}
        </>
      )}
      {kind === "people" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>STAFF MEMBER</TableHead>
              <TableHead>REFERENCE</TableHead>
              <TableHead>OWNER ID (CSV)</TableHead>
              <TableHead>ACCOUNT</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => {
              const account = data.staffDirectory.find(
                (record) => record.id === person.accountId,
              );
              return (
                <TableRow key={person.id}>
                  <TableCell>
                    <strong>{person.name}</strong>
                  </TableCell>
                  <TableCell>{person.reference || "Not recorded"}</TableCell>
                  <TableCell>
                    <code
                      className={
                        "select-all break-all text-xs" +
                        (account?.active ? "" : " muted")
                      }
                    >
                      {person.id}
                    </code>
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyOwnerId(person.id)}
                        disabled={!account?.active || !!copyingOwnerId}
                        aria-label={
                          "Copy owner ID for " +
                          (account?.username ?? person.name)
                        }
                      >
                        <Copy size={14} />
                        {copyingOwnerId === person.id
                          ? "Copying…"
                          : "Copy owner ID"}
                      </Button>
                    </div>
                    {!account?.active && (
                      <span className="cell-secondary">
                        Unavailable for new batteries
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <strong>
                      {account?.username || "Account unavailable"}
                    </strong>
                    <span className="cell-secondary">
                      {account
                        ? account.active
                          ? "Active"
                          : "Inactive"
                        : "Account unavailable"}
                    </span>
                    {person.accountId === data.user.id && (
                      <span className="cell-secondary">Your account</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : kind === "buildings" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>BUILDING CODE</TableHead>
              <TableHead>NAME</TableHead>
              <TableHead>ROOM INFORMATION</TableHead>
              {admin && <TableHead>ACTIONS</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.map((building) => (
              <TableRow
                key={building.id}
                className={
                  !isSupportedBuilding(building.id)
                    ? "unsupported-location-row"
                    : undefined
                }
              >
                <TableCell>
                  <strong>{building.id}</strong>
                </TableCell>
                <TableCell>
                  {building.name}
                  <span className="cell-secondary">
                    {isSupportedBuilding(building.id)
                      ? "Currently supported"
                      : "Not available for selection"}
                  </span>
                </TableCell>
                <TableCell>
                  {isSupportedBuilding(building.id)
                    ? "Placeholder rooms awaiting confirmation"
                    : "Not available"}
                </TableCell>
                {admin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onEdit({ kind: "building", record: building })
                      }
                      disabled={!ready || !isSupportedBuilding(building.id)}
                      aria-label={`Edit ${building.id}`}
                    >
                      <Pencil />
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : kind === "rooms" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ROOM</TableHead>
              <TableHead>BUILDING</TableHead>
              <TableHead>STATUS</TableHead>
              {admin && <TableHead>ACTIONS</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow
                key={room.id}
                className={
                  !isSelectableRoom(room)
                    ? "unsupported-location-row"
                    : undefined
                }
              >
                <TableCell>
                  <strong>
                    {isSupportedBuilding(room.buildingId)
                      ? roomLabel(room)
                      : "Not available"}
                  </strong>
                </TableCell>
                <TableCell>
                  {room.buildingId ? room.building : "Building not assigned"}
                </TableCell>
                <TableCell>
                  {!isSelectableRoom(room)
                    ? "Not available for selection"
                    : room.isPlaceholder
                      ? "Placeholder · awaiting confirmation"
                      : "Confirmed room"}
                </TableCell>
                {admin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit({ kind: "room", record: room })}
                      disabled={!ready || !isSelectableRoom(room)}
                      aria-label={`Edit ${room.name}`}
                    >
                      <Pencil />
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>BATTERY</TableHead>
              <TableHead>RFID IDENTIFIER</TableHead>
              <TableHead>OWNER / STORAGE LOCATION</TableHead>
              {admin && <TableHead>ACTIONS</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batteries.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <button
                    className="record-link"
                    onClick={() => onDetail(b.id)}
                  >
                    {b.id}
                  </button>
                  <span className="cell-secondary">{b.name}</span>
                  <span className="cell-secondary">
                    Age since manufacture: {formatBatteryAge(b.manufacturedOn)}
                  </span>
                </TableCell>
                <TableCell>{b.tagId || "Not assigned"}</TableCell>
                <TableCell>
                  {b.ownerName}
                  <span className="cell-secondary">
                    {b.homeBuildingId || "Building not assigned"} /{" "}
                    {storageRoomLabel(b)}
                  </span>
                </TableCell>
                {admin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit({ kind: "battery", record: b })}
                      disabled={!ready || !isActiveBattery(b)}
                      aria-label={`Edit ${b.id}`}
                    >
                      <Pencil />
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!records.length && (
        <div className="empty-state">
          <Settings2 />
          <h3>No matching {kind === "people" ? "staff members" : kind}</h3>
          <p>
            {kind === "people"
              ? "Staff directory entries come from staff accounts. An administrator manages these through Staff accounts."
              : admin || kind === "batteries"
                ? "Use the registration form or review a CSV import."
                : "Ask an administrator to register these records."}
          </p>
        </div>
      )}
      <div className="panel-footer">
        <span>
          {kind === "buildings" || kind === "rooms"
            ? "J18 is currently supported. Placeholder rooms await confirmation; a battery's room can remain unspecified."
            : kind === "people"
              ? "Use an active Owner ID (CSV) as owner_id when importing batteries. In the downloaded staff directory, this is the id column. Administrators manage staff identities through Staff accounts."
              : "Responsible owners and current holders are distinct staff accounts."}
        </span>
      </div>
    </section>
  );
}
