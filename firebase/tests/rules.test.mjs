// Security Rules tests for firebase/firestore.rules.
// Run from this folder with `npm test` (uses the Firestore emulator and
// the demo-lrc-booking project id, never the live project).

import { readFileSync } from "node:fs";
import { test, before, beforeEach, after } from "node:test";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where,
  writeBatch, serverTimestamp, Timestamp
} from "firebase/firestore";

const MONDAY = "2027-03-01";
const SATURDAY = "2027-03-06";
const SUNDAY = "2027-03-07";
const HOLIDAY = "2027-03-02";

const STUDENT = { uid: "stu1", email: "cruzgm@students.nu-fairview.edu.ph" };
const STUDENT2 = { uid: "stu2", email: "reyesjd@students.nu-fairview.edu.ph" };
const STAFF = { uid: "staff1", email: "limmt@nu-fairview.edu.ph" };

let env;

const SCHEDULE = {
  timezone: "Asia/Manila",
  utcOffsetHours: 8,
  days: {
    "1": { open: true, openHour: 7, closeHour: 19 },
    "2": { open: true, openHour: 7, closeHour: 19 },
    "3": { open: true, openHour: 7, closeHour: 19 },
    "4": { open: true, openHour: 7, closeHour: 19 },
    "5": { open: true, openHour: 7, closeHour: 19 },
    "6": { open: true, openHour: 8, closeHour: 16 },
    "7": { open: false, openHour: 8, closeHour: 16 }
  },
  closedDates: [HOLIDAY]
};

const RESOURCES = {
  "discussion-room-1": { facilityId: "discussion-rooms", facilityName: "Discussion Rooms",
    type: "discussion", number: 1, label: "Discussion Room 1", capacity: 8, status: "active" },
  "silent-seat-1": { facilityId: "silent-area", facilityName: "Silent Area",
    type: "silent", number: 1, label: "Seat number 1", capacity: 1, status: "active" },
  "computer-1": { facilityId: "electronic-library", facilityName: "Electronic Library",
    type: "computer", number: 1, label: "Computer number 1", capacity: 1, status: "maintenance" }
};

function manila(date, hour) {
  const [y, m, d] = date.split("-").map(Number);
  return Timestamp.fromMillis(Date.UTC(y, m - 1, d, hour - 8));
}

function db(user) {
  return env.authenticatedContext(user.uid, { email: user.email }).firestore();
}

async function seed(fn) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lrc-booking",
    firestore: {
      rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (d) => {
    await setDoc(doc(d, "users", STUDENT.uid), { role: "student", name: "Gabe M. Cruz",
      studentNo: "2023-447812", program: "BS Computer Engineering", email: STUDENT.email });
    await setDoc(doc(d, "users", STUDENT2.uid), { role: "student", name: "John D. Reyes",
      studentNo: "2023-104823", program: "BS Civil Engineering", email: STUDENT2.email });
    await setDoc(doc(d, "users", STAFF.uid), { role: "admin", name: "Ma. Teresa Lim",
      email: STAFF.email });
    await setDoc(doc(d, "config", "schedule"), SCHEDULE);
    await setDoc(doc(d, "facilities", "discussion-rooms"), { name: "Discussion Rooms",
      type: "discussion", unitPrefix: "Discussion Room", capacityPerUnit: 8 });
    await setDoc(doc(d, "facilities", "silent-area"), { name: "Silent Area",
      type: "silent", unitPrefix: "Seat number", capacityPerUnit: 1 });
    await setDoc(doc(d, "facilities", "electronic-library"), { name: "Electronic Library",
      type: "computer", unitPrefix: "Computer number", capacityPerUnit: 1 });
    for (const [id, r] of Object.entries(RESOURCES)) {
      await setDoc(doc(d, "resources", id), r);
      await setDoc(doc(d, "resourceLabels", r.facilityId + "_" + r.number), { resourceId: id });
    }
  });
});

after(async () => {
  await env.cleanup();
});

/* ---------- helpers that mirror firebase/firebase-config.js ---------- */

function reservationData(user, profile, resourceId, date, startHour, hours, extra = {}) {
  const r = RESOURCES[resourceId];
  return {
    userId: user.uid,
    studentName: profile.name,
    studentNo: profile.studentNo,
    resourceId,
    resourceLabel: r.label,
    facilityId: r.facilityId,
    facilityName: r.facilityName,
    facilityType: r.type,
    capacity: r.capacity,
    location: "NU Fairview LRC",
    date,
    startHour,
    endHour: startHour + hours,
    start: manila(date, startHour),
    end: manila(date, startHour + hours),
    purpose: "Group Project",
    attendees: [],
    groupSize: 1,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra
  };
}

const GABE = { name: "Gabe M. Cruz", studentNo: "2023-447812" };
const JOHN = { name: "John D. Reyes", studentNo: "2023-104823" };

function book(user, profile, id, resourceId, date, startHour, hours, extra = {}, opts = {}) {
  const d = db(user);
  const batch = writeBatch(d);
  const data = reservationData(user, profile, resourceId, date, startHour, hours, extra);
  batch.set(doc(d, "reservations", id), data);
  const lockHours = opts.lockHours || Array.from({ length: hours }, (_, i) => startHour + i);
  if (!opts.skipLocks) {
    for (const h of lockHours) {
      batch.set(doc(d, "slotLocks", `${resourceId}_${date}_${h}`),
        { resourceId, date, hour: h, reservationId: id });
    }
  }
  return batch.commit();
}

function attendees(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: "Attendee " + (i + 1), studentNo: "2024-" + String(100000 + i)
  }));
}

function staffDecision(id, from, to, opts = {}) {
  const d = db(STAFF);
  const batch = writeBatch(d);
  const auditId = "audit-" + id + "-" + to;
  if (!opts.skipAudit) {
    batch.set(doc(d, "auditLogs", auditId), {
      action: "reservation." + to, actorUid: STAFF.uid, actorName: "Ma. Teresa Lim",
      targetType: "reservation", targetId: id, summary: from + " -> " + to,
      details: {}, createdAt: serverTimestamp()
    });
  }
  batch.update(doc(d, "reservations", id), {
    status: to, updatedAt: serverTimestamp(), decidedAt: serverTimestamp(),
    decidedBy: STAFF.uid, decidedByName: "Ma. Teresa Lim", lastAuditId: auditId
  });
  for (const lock of opts.releaseLocks || []) batch.delete(doc(d, "slotLocks", lock));
  return batch.commit();
}

/* ---------- registration ---------- */

function register(user, profile, opts = {}) {
  const d = db(user);
  const batch = writeBatch(d);
  batch.set(doc(d, "users", user.uid), {
    role: opts.role || "student",
    name: profile.name,
    studentNo: profile.studentNo,
    program: "BS Computer Engineering",
    email: opts.email || user.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(d, "studentNumbers", profile.studentNo), { uid: user.uid });
  return batch.commit();
}

test("student registers with a unique student number", async () => {
  const newbie = { uid: "new1", email: "delacruzj@students.nu-fairview.edu.ph" };
  await assertSucceeds(register(newbie, { name: "Juan Dela Cruz", studentNo: "2025-000001" }));
});

test("duplicate student numbers are rejected", async () => {
  const a = { uid: "new1", email: "a@students.nu-fairview.edu.ph" };
  const b = { uid: "new2", email: "b@students.nu-fairview.edu.ph" };
  await assertSucceeds(register(a, { name: "Ana Uno", studentNo: "2025-000002" }));
  await assertFails(register(b, { name: "Ben Dos", studentNo: "2025-000002" }));
});

test("sign-up cannot grant staff or admin roles", async () => {
  const sneaky = { uid: "new3", email: "x@students.nu-fairview.edu.ph" };
  await assertFails(register(sneaky, { name: "Sneaky One", studentNo: "2025-000003" }, { role: "admin" }));
  await assertFails(register(sneaky, { name: "Sneaky One", studentNo: "2025-000003" }, { role: "staff" }));
});

test("sign-up requires an NU Fairview e-mail matching the auth token", async () => {
  const outsider = { uid: "new4", email: "someone@gmail.com" };
  await assertFails(register(outsider, { name: "Out Sider", studentNo: "2025-000004" }));
  const mismatch = { uid: "new5", email: "real@students.nu-fairview.edu.ph" };
  await assertFails(register(mismatch, { name: "Mis Match", studentNo: "2025-000005" },
    { email: "other@students.nu-fairview.edu.ph" }));
});

test("students cannot promote themselves or change their student number", async () => {
  await assertFails(updateDoc(doc(db(STUDENT), "users", STUDENT.uid), { role: "admin" }));
  await assertFails(updateDoc(doc(db(STUDENT), "users", STUDENT.uid), { studentNo: "2023-000000" }));
  await assertSucceeds(updateDoc(doc(db(STUDENT), "users", STUDENT.uid),
    { program: "BS Computer Science", updatedAt: serverTimestamp() }));
});

test("profiles are private to their owner and staff", async () => {
  await assertSucceeds(getDoc(doc(db(STUDENT), "users", STUDENT.uid)));
  await assertFails(getDoc(doc(db(STUDENT), "users", STUDENT2.uid)));
  await assertSucceeds(getDoc(doc(db(STAFF), "users", STUDENT2.uid)));
  await assertFails(getDocs(collection(db(STUDENT), "users")));
});

/* ---------- booking ---------- */

test("one-hour and two-hour bookings succeed", async () => {
  await assertSucceeds(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1));
  await assertSucceeds(book(STUDENT, GABE, "r2", "discussion-room-1", MONDAY, 13, 2));
});

test("bookings longer than two hours are rejected", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 3));
});

test("overlapping bookings for the same unit are rejected", async () => {
  await assertSucceeds(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 10, 2));
  // same start hour
  await assertFails(book(STUDENT2, JOHN, "r2", "discussion-room-1", MONDAY, 10, 1));
  // overlaps the second hour
  await assertFails(book(STUDENT2, JOHN, "r3", "discussion-room-1", MONDAY, 11, 2));
  // starts an hour earlier and runs into the booking
  await assertFails(book(STUDENT2, JOHN, "r4", "discussion-room-1", MONDAY, 9, 2));
  // back-to-back is fine
  await assertSucceeds(book(STUDENT2, JOHN, "r5", "discussion-room-1", MONDAY, 12, 1));
});

test("a booking blocks only its own unit", async () => {
  await assertSucceeds(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1));
  await assertSucceeds(book(STUDENT2, JOHN, "r2", "discussion-room-1", MONDAY, 9, 1));
});

test("a reservation without its slot locks is rejected", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1, {}, { skipLocks: true }));
  await assertFails(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 2, {}, { lockHours: [9] }));
});

test("bookings must fall inside the configured operating hours", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 6, 1));     // before 7 AM
  await assertFails(book(STUDENT, GABE, "r2", "silent-seat-1", MONDAY, 18, 2));    // past 7 PM
  await assertSucceeds(book(STUDENT, GABE, "r3", "silent-seat-1", MONDAY, 18, 1)); // 6-7 PM
  await assertSucceeds(book(STUDENT, GABE, "r4", "silent-seat-1", SATURDAY, 8, 1));
  await assertFails(book(STUDENT, GABE, "r5", "silent-seat-1", SATURDAY, 15, 2));  // past 4 PM
  await assertFails(book(STUDENT, GABE, "r6", "silent-seat-1", SUNDAY, 10, 1));    // closed
  await assertFails(book(STUDENT, GABE, "r7", "silent-seat-1", HOLIDAY, 10, 1));   // closure date
});

test("schedule changes take effect immediately", async () => {
  await seed((d) => setDoc(doc(d, "config", "schedule"), {
    ...SCHEDULE, days: { ...SCHEDULE.days, "7": { open: true, openHour: 9, closeHour: 12 } }
  }));
  await assertSucceeds(book(STUDENT, GABE, "r1", "silent-seat-1", SUNDAY, 10, 1));
});

test("past bookings are rejected", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "silent-seat-1", "2025-03-03", 9, 1));
});

test("units under maintenance cannot be booked", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "computer-1", MONDAY, 9, 1));
});

test("discussion rooms allow the booking student plus up to 7 attendees", async () => {
  await assertSucceeds(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 1,
    { attendees: attendees(7), groupSize: 8 }));
  await assertFails(book(STUDENT2, JOHN, "r2", "discussion-room-1", MONDAY, 10, 1,
    { attendees: attendees(8), groupSize: 9 }));
  // group size must equal attendees + 1
  await assertFails(book(STUDENT2, JOHN, "r3", "discussion-room-1", MONDAY, 11, 1,
    { attendees: attendees(2), groupSize: 2 }));
});

test("every attendee needs a name and a valid student number", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 1,
    { attendees: [{ name: "No Number", studentNo: "" }], groupSize: 2 }));
  await assertFails(book(STUDENT, GABE, "r2", "discussion-room-1", MONDAY, 9, 1,
    { attendees: [{ name: "", studentNo: "2024-123456" }], groupSize: 2 }));
});

test("single-person units take no attendees", async () => {
  await assertFails(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1,
    { attendees: attendees(1), groupSize: 2 }));
});

test("reservations cannot spoof identity, status, or resource details", async () => {
  await assertFails(book(STUDENT, JOHN, "r1", "silent-seat-1", MONDAY, 9, 1));
  await assertFails(book(STUDENT, GABE, "r2", "silent-seat-1", MONDAY, 9, 1, { status: "confirmed" }));
  await assertFails(book(STUDENT, GABE, "r3", "silent-seat-1", MONDAY, 9, 1, { capacity: 8 }));
  await assertFails(book(STUDENT, GABE, "r4", "silent-seat-1", MONDAY, 9, 1,
    { start: manila(MONDAY, 10) }));
});

test("staff accounts cannot create student reservations", async () => {
  await assertFails(book(STAFF, { name: "Ma. Teresa Lim", studentNo: undefined },
    "r1", "silent-seat-1", MONDAY, 9, 1, { studentNo: "LRC" }));
});

/* ---------- reading reservations ---------- */

test("students see only their own reservations; slot locks are public", async () => {
  await book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 1,
    { attendees: attendees(2), groupSize: 3 });
  await assertFails(getDoc(doc(db(STUDENT2), "reservations", "r1")));
  await assertFails(getDocs(collection(db(STUDENT2), "reservations")));
  await assertSucceeds(getDocs(query(collection(db(STUDENT), "reservations"),
    where("userId", "==", STUDENT.uid))));
  await assertSucceeds(getDocs(query(collection(db(STUDENT2), "slotLocks"),
    where("date", "==", MONDAY))));
  await assertSucceeds(getDocs(query(collection(db(STAFF), "reservations"),
    where("date", "==", MONDAY))));
});

/* ---------- cancellation ---------- */

test("students cancel their own booking and release its slots", async () => {
  await book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 2);
  const d = db(STUDENT);
  const cancel = writeBatch(d);
  cancel.update(doc(d, "reservations", "r1"), { status: "cancelled",
    updatedAt: serverTimestamp(), cancelledAt: serverTimestamp(), cancelledBy: STUDENT.uid });
  cancel.delete(doc(d, "slotLocks", `discussion-room-1_${MONDAY}_9`));
  cancel.delete(doc(d, "slotLocks", `discussion-room-1_${MONDAY}_10`));
  await assertSucceeds(cancel.commit());
  // the slot is free again
  await assertSucceeds(book(STUDENT2, JOHN, "r2", "discussion-room-1", MONDAY, 9, 1));
});

test("cancelling must release every slot lock", async () => {
  await book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 2);
  const d = db(STUDENT);
  const cancel = writeBatch(d);
  cancel.update(doc(d, "reservations", "r1"), { status: "cancelled",
    updatedAt: serverTimestamp(), cancelledAt: serverTimestamp(), cancelledBy: STUDENT.uid });
  cancel.delete(doc(d, "slotLocks", `discussion-room-1_${MONDAY}_9`));
  await assertFails(cancel.commit());
});

test("students cannot cancel someone else's booking or delete its locks", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  const d = db(STUDENT2);
  const cancel = writeBatch(d);
  cancel.update(doc(d, "reservations", "r1"), { status: "cancelled",
    updatedAt: serverTimestamp(), cancelledAt: serverTimestamp(), cancelledBy: STUDENT2.uid });
  cancel.delete(doc(d, "slotLocks", `silent-seat-1_${MONDAY}_9`));
  await assertFails(cancel.commit());
});

test("cancellation closes one hour before the start", async () => {
  const soon = new Date(Date.now() + 30 * 60 * 1000);
  const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
  await seed(async (d) => {
    for (const [id, when] of [["soon", soon], ["later", later]]) {
      await setDoc(doc(d, "reservations", id), {
        userId: STUDENT.uid, status: "confirmed", resourceId: "silent-seat-1",
        date: "2000-01-01", startHour: 100, endHour: 101,
        start: Timestamp.fromDate(when), end: Timestamp.fromDate(new Date(when.getTime() + 3600e3))
      });
    }
  });
  const fields = { status: "cancelled", updatedAt: serverTimestamp(),
    cancelledAt: serverTimestamp(), cancelledBy: STUDENT.uid };
  await assertFails(updateDoc(doc(db(STUDENT), "reservations", "soon"), fields));
  await assertSucceeds(updateDoc(doc(db(STUDENT), "reservations", "later"), fields));
});

/* ---------- staff decisions ---------- */

test("staff approve, complete, and reject with an audit entry", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await book(STUDENT, GABE, "r2", "silent-seat-1", MONDAY, 10, 1);
  await assertSucceeds(staffDecision("r1", "pending", "confirmed"));
  await assertSucceeds(staffDecision("r1", "confirmed", "completed",
    { releaseLocks: [`silent-seat-1_${MONDAY}_9`] }));
  await assertSucceeds(staffDecision("r2", "pending", "rejected",
    { releaseLocks: [`silent-seat-1_${MONDAY}_10`] }));
  // rejected and completed bookings no longer block the unit
  await assertSucceeds(book(STUDENT2, JOHN, "r3", "silent-seat-1", MONDAY, 9, 2));
});

test("staff decisions without an audit entry are rejected", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await assertFails(staffDecision("r1", "pending", "confirmed", { skipAudit: true }));
});

test("invalid status transitions are rejected", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await assertFails(staffDecision("r1", "pending", "completed",
    { releaseLocks: [`silent-seat-1_${MONDAY}_9`] }));
});

test("rejecting must release the slot locks", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await assertFails(staffDecision("r1", "pending", "rejected"));
});

test("students cannot approve reservations", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await assertFails(updateDoc(doc(db(STUDENT), "reservations", "r1"),
    { status: "confirmed", updatedAt: serverTimestamp() }));
});

/* ---------- resources ---------- */

function addUnit(user, id, facilityId, number, label, opts = {}) {
  const d = db(user);
  const batch = writeBatch(d);
  const facility = { "electronic-library": ["Electronic Library", "computer", 1],
    "discussion-rooms": ["Discussion Rooms", "discussion", 8] }[facilityId];
  const auditId = "audit-add-" + id;
  batch.set(doc(d, "auditLogs", auditId), {
    action: "resource.added", actorUid: user.uid, actorName: "Ma. Teresa Lim",
    targetType: "resource", targetId: id, summary: "Added " + label, details: {},
    createdAt: serverTimestamp()
  });
  batch.set(doc(d, "resources", id), {
    facilityId, facilityName: facility[0], type: facility[1], number, label,
    capacity: facility[2], status: "active", statusNote: "",
    createdAt: serverTimestamp(), createdBy: user.uid,
    updatedAt: serverTimestamp(), updatedBy: user.uid, removedAt: null, lastAuditId: auditId
  });
  if (!opts.skipLabel) {
    batch.set(doc(d, "resourceLabels", facilityId + "_" + number), { resourceId: id });
  }
  return batch.commit();
}

function setUnitStatus(id, facilityId, number, status, opts = {}) {
  const d = db(STAFF);
  const batch = writeBatch(d);
  const auditId = "audit-" + status + "-" + id + (opts.suffix || "");
  batch.set(doc(d, "auditLogs", auditId), {
    action: "resource." + status, actorUid: STAFF.uid, actorName: "Ma. Teresa Lim",
    targetType: "resource", targetId: id, summary: status, details: {},
    createdAt: serverTimestamp()
  });
  const update = { status, updatedAt: serverTimestamp(), updatedBy: STAFF.uid, lastAuditId: auditId };
  if (status === "removed") update.removedAt = serverTimestamp();
  batch.update(doc(d, "resources", id), update);
  if (status === "removed" && !opts.keepLabel) {
    batch.delete(doc(d, "resourceLabels", facilityId + "_" + number));
  }
  return batch.commit();
}

test("staff add a unit with a unique numbered label", async () => {
  await assertSucceeds(addUnit(STAFF, "pc-new", "electronic-library", 2, "Computer number 2"));
  await assertFails(addUnit(STAFF, "pc-dup", "electronic-library", 2, "Computer number 2"));
  await assertFails(addUnit(STAFF, "pc-bad", "electronic-library", 3, "Computer 3"));
  await assertFails(addUnit(STAFF, "pc-nolabel", "electronic-library", 4, "Computer number 4",
    { skipLabel: true }));
});

test("students cannot add or change units", async () => {
  await assertFails(addUnit(STUDENT, "pc-new", "electronic-library", 2, "Computer number 2"));
  await assertFails(updateDoc(doc(db(STUDENT), "resources", "silent-seat-1"),
    { status: "maintenance" }));
});

test("maintenance toggles require an audit entry", async () => {
  await assertSucceeds(setUnitStatus("silent-seat-1", "silent-area", 1, "maintenance"));
  await assertFails(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1));
  await assertSucceeds(setUnitStatus("silent-seat-1", "silent-area", 1, "active", { suffix: "-2" }));
  await assertSucceeds(book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1));
  await assertFails(updateDoc(doc(db(STAFF), "resources", "silent-seat-1"), {
    status: "maintenance", updatedAt: serverTimestamp(), updatedBy: STAFF.uid
  }));
});

test("removed units keep their record and free the label for a new unit", async () => {
  await assertFails(setUnitStatus("discussion-room-1", "discussion-rooms", 1, "removed",
    { keepLabel: true }));
  await assertSucceeds(setUnitStatus("discussion-room-1", "discussion-rooms", 1, "removed"));
  const old = await getDoc(doc(db(STUDENT), "resources", "discussion-room-1"));
  if (old.data().status !== "removed") throw new Error("removed unit should remain readable");
  // removed units cannot come back or be booked
  await assertFails(setUnitStatus("discussion-room-1", "discussion-rooms", 1, "active", { suffix: "-x" }));
  await assertFails(book(STUDENT, GABE, "r1", "discussion-room-1", MONDAY, 9, 1));
  // the label can be reused under a new stable id
  await assertSucceeds(addUnit(STAFF, "dr-replacement", "discussion-rooms", 1, "Discussion Room 1"));
});

/* ---------- schedule, audit, notifications ---------- */

function saveSchedule(user, days) {
  const d = db(user);
  const batch = writeBatch(d);
  batch.set(doc(d, "auditLogs", "audit-schedule-" + user.uid), {
    action: "schedule.updated", actorUid: user.uid, actorName: "Ma. Teresa Lim",
    targetType: "schedule", targetId: "schedule", summary: "Updated hours", details: {},
    createdAt: serverTimestamp()
  });
  batch.set(doc(d, "config", "schedule"), {
    ...SCHEDULE, days, updatedAt: serverTimestamp(), updatedBy: user.uid,
    lastAuditId: "audit-schedule-" + user.uid
  });
  return batch.commit();
}

test("only staff can change the operating schedule", async () => {
  const days = { ...SCHEDULE.days, "7": { open: true, openHour: 9, closeHour: 12 } };
  await assertFails(saveSchedule(STUDENT, days));
  await assertSucceeds(saveSchedule(STAFF, days));
  await assertFails(saveSchedule(STAFF,
    { ...SCHEDULE.days, "1": { open: true, openHour: 19, closeHour: 7 } }));
});

test("audit logs are staff-only and append-only", async () => {
  await book(STUDENT, GABE, "r1", "silent-seat-1", MONDAY, 9, 1);
  await staffDecision("r1", "pending", "confirmed");
  await assertFails(getDocs(collection(db(STUDENT), "auditLogs")));
  await assertSucceeds(getDocs(collection(db(STAFF), "auditLogs")));
  await assertFails(updateDoc(doc(db(STAFF), "auditLogs", "audit-r1-confirmed"), { summary: "edited" }));
});

test("notifications are private to their recipient", async () => {
  const d = db(STAFF);
  await assertSucceeds(setDoc(doc(d, "notifications", "n1"), {
    userId: STUDENT.uid, message: "Your reservation was approved.", reservationId: "r1",
    kind: "confirmed", read: false, createdAt: serverTimestamp()
  }));
  await assertSucceeds(getDocs(query(collection(db(STUDENT), "notifications"),
    where("userId", "==", STUDENT.uid))));
  await assertFails(getDoc(doc(db(STUDENT2), "notifications", "n1")));
  await assertSucceeds(updateDoc(doc(db(STUDENT), "notifications", "n1"), { read: true }));
  await assertFails(setDoc(doc(db(STUDENT2), "notifications", "n2"), {
    userId: STUDENT.uid, message: "spoofed", reservationId: "r1",
    kind: "confirmed", read: false, createdAt: serverTimestamp()
  }));
});
