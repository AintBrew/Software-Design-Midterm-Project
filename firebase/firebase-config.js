/* ============================================================
   NU Fairview LRC Study Area Online Booking System
   firebase/firebase-config.js

   The one place that talks to Firebase. Pages import what they
   need from here; page-specific UI stays in each page's own JS.

   - Firebase project configuration (FIREBASE_CONFIG below)
   - Authentication: register, sign in, sign out, role checks
   - Cloud Firestore reads/writes for profiles, facilities,
     reservable units, the LRC schedule, reservations, in-app
     notifications, and the staff audit trail

   Data model and setup steps: firebase/README.md
   Security Rules (the real enforcement): firebase/firestore.rules
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, setPersistence,
  browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  deleteUser, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs,
  onSnapshot, query, where, orderBy, limit, writeBatch, runTransaction,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ---------- project configuration ----------
   Public web app config for the "lrc-project" Firebase project
   (Firebase console > Project settings > Your apps > LRC Booking Web).
   These values identify the project; they are not secrets. Access is
   controlled by firebase/firestore.rules. To point the site at a
   different project, replace this object with that project's config. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBK55SWSSrcHH61qxv8iCkgNM2eimfBJh8",
  authDomain: "lrc-project-de364.firebaseapp.com",
  projectId: "lrc-project-de364",
  storageBucket: "lrc-project-de364.firebasestorage.app",
  messagingSenderId: "678752864433",
  appId: "1:678752864433:web:b25a87c8ac06009ee5fa90"
};

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local testing against the Firebase emulators: open any page once with
// ?emulator=1 (and ?emulator=0 to switch back). Kept for this tab only.
const EMULATOR_KEY = "lrc_use_emulators";
(function () {
  try {
    var flag = new URLSearchParams(window.location.search).get("emulator");
    if (flag === "1") sessionStorage.setItem(EMULATOR_KEY, "1");
    if (flag === "0") sessionStorage.removeItem(EMULATOR_KEY);
    if (sessionStorage.getItem(EMULATOR_KEY) === "1") {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
  } catch (e) { /* storage blocked - use the live project */ }
})();

/* ---------- LRC constants ---------- */

export const LOCATION = "NU Fairview LRC";
export const TIMEZONE = "Asia/Manila";
export const UTC_OFFSET_HOURS = 8;           // Philippines, no daylight saving
export const MAX_BOOKING_HOURS = 2;
export const CANCEL_NOTICE_MS = 60 * 60 * 1000;
export const ACTIVE_STATUSES = ["pending", "confirmed"];

// Days use 1 = Monday ... 7 = Sunday, the same numbering as the rules.
export const INITIAL_SCHEDULE = {
  timezone: TIMEZONE,
  utcOffsetHours: UTC_OFFSET_HOURS,
  days: {
    "1": { open: true,  openHour: 7, closeHour: 19 },
    "2": { open: true,  openHour: 7, closeHour: 19 },
    "3": { open: true,  openHour: 7, closeHour: 19 },
    "4": { open: true,  openHour: 7, closeHour: 19 },
    "5": { open: true,  openHour: 7, closeHour: 19 },
    "6": { open: true,  openHour: 8, closeHour: 16 },
    "7": { open: false, openHour: 8, closeHour: 16 }   // Sunday: closed until staff set hours
  },
  closedDates: []
};

export const INITIAL_FACILITIES = [
  {
    id: "discussion-rooms", name: "Discussion Rooms", alias: "",
    type: "discussion", unitPrefix: "Discussion Room", capacityPerUnit: 8,
    unitIdPrefix: "discussion-room-", initialUnits: 4, image: "room-discussion", order: 1,
    description: "Enclosed rooms for group study and discussion, up to 8 people per room."
  },
  {
    id: "silent-area", name: "Silent Area", alias: "",
    type: "silent", unitPrefix: "Seat number", capacityPerUnit: 1,
    unitIdPrefix: "silent-seat-", initialUnits: 10, image: "room-booth", order: 2,
    description: "Individual tables for quiet, focused study. One person per table."
  },
  {
    id: "electronic-library", name: "Electronic Library", alias: "Computer Area",
    type: "computer", unitPrefix: "Computer number", capacityPerUnit: 1,
    unitIdPrefix: "computer-", initialUnits: 14, image: "room-seminar", order: 3,
    description: "Computer workstations for research and coursework. One person per computer."
  }
];

/* ---------- NU Fairview time ---------- */

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

// "YYYY-MM-DD" for an instant, in NU Fairview local time.
export function manilaDateISO(ms) {
  var d = new Date((ms === undefined ? Date.now() : ms) + UTC_OFFSET_HOURS * 3600e3);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

// Instant (ms) for a local date and hour at NU Fairview.
export function manilaInstant(dateISO, hour) {
  var p = dateISO.split("-").map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2], hour - UTC_OFFSET_HOURS);
}

// 1 = Monday ... 7 = Sunday for a local date.
export function isoWeekday(dateISO) {
  var p = dateISO.split("-").map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return d === 0 ? 7 : d;
}

// Opening hours for a date, or null when the LRC is closed.
export function hoursOn(schedule, dateISO) {
  if (!schedule || !schedule.days) return null;
  if ((schedule.closedDates || []).indexOf(dateISO) !== -1) return null;
  var day = schedule.days[String(isoWeekday(dateISO))];
  if (!day || !day.open) return null;
  return { openHour: day.openHour, closeHour: day.closeHour };
}

function lockId(resourceId, dateISO, hour) {
  return resourceId + "_" + dateISO + "_" + hour;
}

// Set of "resourceId_hour" keys booked on one date, from watchSlotLocks.
export function bookedSet(locks) {
  var set = new Set();
  locks.forEach(function (l) { set.add(l.resourceId + "_" + l.hour); });
  return set;
}

// Live state of every one-hour slot of a unit on a date:
// "free", "reserved" (another booking holds it), "unavailable"
// (unit under maintenance or removed), or "past".
// Returns [] when the LRC is closed that day.
export function slotStates(resource, schedule, booked, dateISO, nowMs) {
  var open = hoursOn(schedule, dateISO);
  if (!open) return [];
  var now = nowMs || Date.now();
  var states = [];
  for (var h = open.openHour; h < open.closeHour; h++) {
    var state = "free";
    if (resource.status !== "active") state = "unavailable";
    else if (manilaInstant(dateISO, h) <= now) state = "past";
    else if (booked.has(resource.id + "_" + h)) state = "reserved";
    states.push({ hour: h, state: state });
  }
  return states;
}

function hourLabel(h) {
  var suffix = h >= 12 && h < 24 ? "PM" : "AM";
  var hour = h % 12;
  if (hour === 0) hour = 12;
  return hour + ":00 " + suffix;
}

function describeBooking(r) {
  var p = r.date.split("-").map(Number);
  var when = new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC"
  });
  return r.resourceLabel + " (" + r.facilityName + ") on " + when + ", "
       + hourLabel(r.startHour) + " - " + hourLabel(r.endHour);
}

/* ---------- errors ---------- */

// notification messages and audit summaries are capped at 300 characters by the rules
function clip(text) {
  return text.length > 300 ? text.slice(0, 297) + "..." : text;
}

function lrcError(code, message, extra) {
  var err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

// Plain-language text for any Firebase or booking error.
export function describeError(err) {
  var code = (err && err.code) || "";
  var messages = {
    "lrc/conflict": "Someone else just booked that unit for this time. Pick another time slot or unit.",
    "lrc/unavailable-unit": "That unit is no longer available for booking. Choose another unit.",
    "lrc/outside-hours": "That time is outside the LRC operating hours for the selected day.",
    "lrc/past": "That time has already passed. Choose a later time slot.",
    "lrc/too-late-to-cancel": "Reservations can only be cancelled at least 1 hour before they start.",
    "lrc/not-cancellable": "This reservation can no longer be cancelled.",
    "lrc/stale": "This reservation was changed by someone else. The list has been refreshed.",
    "lrc/has-future-reservations": "This unit still has upcoming reservations. Cancel them before removing the unit.",
    "lrc/label-taken": "Another unit already uses that number. Refresh and try again.",
    "lrc/student-number-taken": "That student number is already registered. Sign in instead, or contact the LRC if this is a mistake.",
    "lrc/no-profile": "Your account has no LRC profile yet. Contact the LRC staff for help.",
    "permission-denied": "You do not have permission to do that, or the booking no longer meets the LRC rules. Refresh the page and try again.",
    "unavailable": "Cannot reach the booking server. Check your internet connection and try again.",
    "deadline-exceeded": "The booking server took too long to respond. Check your connection and try again.",
    "failed-precondition": "The database needs a setup step (a missing index). Ask the LRC administrator to follow firebase/README.md.",
    "aborted": "Too many people changed this at once. Please try again.",
    "auth/invalid-credential": "That e-mail and password do not match an account. Check both and try again.",
    "auth/invalid-login-credentials": "That e-mail and password do not match an account. Check both and try again.",
    "auth/user-not-found": "No account uses that e-mail. Create a student account first.",
    "auth/wrong-password": "That password does not match this account. Please re-enter it.",
    "auth/invalid-email": "That does not look like a valid e-mail address.",
    "auth/email-already-in-use": "An account already uses this e-mail. Sign in instead.",
    "auth/weak-password": "Choose a stronger password with at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes, then try again.",
    "auth/network-request-failed": "Cannot reach the sign-in server. Check your internet connection and try again.",
    "auth/user-disabled": "This account has been disabled. Contact the LRC staff.",
    "auth/operation-not-allowed": "E-mail sign-in is not enabled for this Firebase project yet. See firebase/README.md.",
    "auth/configuration-not-found": "Firebase Authentication is not set up for this project yet. See firebase/README.md."
  };
  return messages[code] || (err && err.message) || "Something went wrong. Please try again.";
}

/* ---------- authentication and profiles ---------- */

export const HOME = {
  student: "../main_dashboard/main_dashboard.html",
  staff: "../admin_dashboard/admin_dashboard.html",
  admin: "../admin_dashboard/admin_dashboard.html"
};

export function isStaffRole(role) {
  return role === "staff" || role === "admin";
}

function authReady() {
  return new Promise(function (resolve) {
    var stop = onAuthStateChanged(auth, function (user) {
      stop();
      resolve(user);
    });
  });
}

export async function getProfile(uid) {
  var snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? Object.assign({ uid: uid }, snap.data()) : null;
}

// Signed-in profile for this page, or a redirect to the right place.
// role: "student" or "staff". Resolves to null while redirecting.
export async function requireRole(role) {
  var user = await authReady();
  if (!user) {
    window.location.replace("../login/login.html");
    return null;
  }
  var profile = await getProfile(user.uid);   // errors reach the page
  if (!profile) {
    await signOut(auth);
    window.location.replace("../login/login.html?noprofile=1");
    return null;
  }
  var allowed = role === "staff" ? isStaffRole(profile.role) : profile.role === role;
  if (!allowed) {
    window.location.replace(HOME[profile.role] || "../login/login.html");
    return null;
  }
  return profile;
}

// Profile of an already signed-in user (used by the login page).
export async function currentProfile() {
  var user = await authReady();
  return user ? getProfile(user.uid) : null;
}

export async function signInUser(email, password, remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  var cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  var profile = await getProfile(cred.user.uid);
  if (!profile) {
    await signOut(auth);
    // the UID helps staff find or create the matching users/{uid} document
    throw lrcError("lrc/no-profile", "No profile", { uid: cred.user.uid });
  }
  return profile;
}

export function signOutUser() {
  return signOut(auth);
}

// Creates the Firebase Auth account, then the Firestore profile and the
// student-number claim in one batch. Rolls back the account on failure.
export async function registerStudent(details) {
  var email = details.email.trim().toLowerCase();
  await setPersistence(auth, browserSessionPersistence);
  var cred = await createUserWithEmailAndPassword(auth, email, details.password);
  var user = cred.user;

  try {
    var claim = await getDoc(doc(db, "studentNumbers", details.studentNo));
    if (claim.exists()) throw lrcError("lrc/student-number-taken", "Student number taken");

    var profile = {
      role: "student",
      name: details.name,
      studentNo: details.studentNo,
      program: details.program,
      email: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (details.username) profile.username = details.username;

    var batch = writeBatch(db);
    batch.set(doc(db, "users", user.uid), profile);
    batch.set(doc(db, "studentNumbers", details.studentNo), { uid: user.uid });
    await batch.commit();
    try { await updateProfile(user, { displayName: details.name }); } catch (e) { /* cosmetic */ }
  } catch (err) {
    // keep Auth and Firestore consistent: no account without a profile
    try { await deleteUser(user); } catch (e) { await signOut(auth); }
    if (err.code === "permission-denied") {
      throw lrcError("lrc/student-number-taken", "Student number taken");
    }
    throw err;
  }
  await signOut(auth);
  return email;
}

/* ---------- live listeners ----------
   Each returns an unsubscribe function. onError receives the
   Firebase error so the page can show it. */

function listen(ref, onData, onError, mapDocs) {
  return onSnapshot(ref, function (snap) {
    onData(mapDocs ? snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    }) : (snap.exists() ? snap.data() : null));
  }, onError);
}

export function watchSchedule(onData, onError) {
  return listen(doc(db, "config", "schedule"), onData, onError, false);
}

export function watchFacilities(onData, onError) {
  return listen(collection(db, "facilities"), function (list) {
    onData(list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); }));
  }, onError, true);
}

// All units, including removed ones (kept for history).
export function watchResources(onData, onError) {
  return listen(collection(db, "resources"), function (list) {
    onData(list.sort(function (a, b) {
      return a.facilityId === b.facilityId ? a.number - b.number
           : a.facilityId.localeCompare(b.facilityId);
    }));
  }, onError, true);
}

// Booked resource-hours for one date. Holds no personal data.
export function watchSlotLocks(dateISO, onData, onError) {
  return listen(query(collection(db, "slotLocks"), where("date", "==", dateISO)),
    onData, onError, true);
}

export function watchMyReservations(uid, onData, onError) {
  return listen(query(collection(db, "reservations"), where("userId", "==", uid)),
    onData, onError, true);
}

export function watchMyNotifications(uid, onData, onError) {
  return listen(query(collection(db, "notifications"), where("userId", "==", uid)),
    function (list) {
      onData(list.sort(function (a, b) { return millis(b.createdAt) - millis(a.createdAt); }));
    }, onError, true);
}

export async function markNotificationsRead(ids) {
  if (!ids.length) return;
  var batch = writeBatch(db);
  ids.forEach(function (id) {
    batch.update(doc(db, "notifications", id), { read: true });
  });
  await batch.commit();
}

// Staff: reservations with dates in [fromISO, toISO].
export function watchReservationsBetween(fromISO, toISO, onData, onError) {
  return listen(query(collection(db, "reservations"),
    where("date", ">=", fromISO), where("date", "<=", toISO), orderBy("date")),
    onData, onError, true);
}

export async function getReservationsBetween(fromISO, toISO) {
  var snap = await getDocs(query(collection(db, "reservations"),
    where("date", ">=", fromISO), where("date", "<=", toISO), orderBy("date")));
  return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
}

export function watchPendingReservations(onData, onError) {
  return listen(query(collection(db, "reservations"), where("status", "==", "pending")),
    onData, onError, true);
}

export function watchAuditLog(count, onData, onError) {
  return listen(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(count)),
    onData, onError, true);
}

export function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return Number(value) || 0;
}

/* ---------- students: create and cancel ---------- */

// Books `hours` contiguous one-hour slots on one unit. The transaction
// re-checks every slot lock at commit time, so if another student wins
// the race this rejects with code "lrc/conflict" and nothing is written.
export async function createReservation(input) {
  var profile = input.profile;
  var resource = input.resource;
  var hours = input.hours;
  var startHour = input.startHour;
  var date = input.date;
  var attendees = (input.attendees || []).map(function (a) {
    return { name: a.name.trim(), studentNo: a.studentNo.trim() };
  });

  if (hours < 1 || hours > MAX_BOOKING_HOURS) throw lrcError("lrc/outside-hours", "Bad duration");
  if (attendees.length + 1 > resource.capacity) {
    throw lrcError("lrc/capacity", "This unit holds up to " + resource.capacity
      + (resource.capacity === 1 ? " person." : " people, including you."));
  }

  var reservationRef = doc(collection(db, "reservations"));
  var lockRefs = [];
  for (var h = startHour; h < startHour + hours; h++) {
    lockRefs.push({ hour: h, ref: doc(db, "slotLocks", lockId(resource.id, date, h)) });
  }

  await runTransaction(db, async function (tx) {
    var resSnap = await tx.get(doc(db, "resources", resource.id));
    var schedSnap = await tx.get(doc(db, "config", "schedule"));
    var lockSnaps = [];
    for (var i = 0; i < lockRefs.length; i++) lockSnaps.push(await tx.get(lockRefs[i].ref));

    if (!resSnap.exists() || resSnap.data().status !== "active") {
      throw lrcError("lrc/unavailable-unit", "Unit unavailable");
    }
    var open = hoursOn(schedSnap.exists() ? schedSnap.data() : null, date);
    if (!open || startHour < open.openHour || startHour + hours > open.closeHour) {
      throw lrcError("lrc/outside-hours", "Outside hours");
    }
    if (manilaInstant(date, startHour) <= Date.now()) throw lrcError("lrc/past", "Past");
    if (lockSnaps.some(function (s) { return s.exists(); })) {
      throw lrcError("lrc/conflict", "Slot taken");
    }

    var live = resSnap.data();
    var reservation = {
      userId: profile.uid,
      studentName: profile.name,
      studentNo: profile.studentNo,
      resourceId: resource.id,
      resourceLabel: live.label,
      facilityId: live.facilityId,
      facilityName: live.facilityName,
      facilityType: live.type,
      capacity: live.capacity,
      location: LOCATION,
      date: date,
      startHour: startHour,
      endHour: startHour + hours,
      start: Timestamp.fromMillis(manilaInstant(date, startHour)),
      end: Timestamp.fromMillis(manilaInstant(date, startHour + hours)),
      purpose: input.purpose,
      attendees: attendees,
      groupSize: attendees.length + 1,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    tx.set(reservationRef, reservation);
    lockRefs.forEach(function (l) {
      tx.set(l.ref, { resourceId: resource.id, date: date, hour: l.hour,
                      reservationId: reservationRef.id });
    });
    tx.set(doc(collection(db, "notifications")), {
      userId: profile.uid,
      message: clip("Reservation submitted for " + describeBooking(reservation)
             + ". It is pending LRC staff approval."),
      reservationId: reservationRef.id,
      kind: "submitted",
      read: false,
      createdAt: serverTimestamp()
    });
  });

  return reservationRef.id;
}

export function canStudentCancel(r, nowMs) {
  return ACTIVE_STATUSES.indexOf(r.status) !== -1
    && millis(r.start) - (nowMs || Date.now()) >= CANCEL_NOTICE_MS;
}

function lockRefsFor(r) {
  var refs = [];
  for (var h = r.startHour; h < r.endHour; h++) {
    refs.push(doc(db, "slotLocks", lockId(r.resourceId, r.date, h)));
  }
  return refs;
}

export async function cancelMyReservation(reservationId, uid) {
  var ref = doc(db, "reservations", reservationId);
  await runTransaction(db, async function (tx) {
    var snap = await tx.get(ref);
    if (!snap.exists() || snap.data().userId !== uid) throw lrcError("lrc/stale", "Missing");
    var r = snap.data();
    if (ACTIVE_STATUSES.indexOf(r.status) === -1) throw lrcError("lrc/not-cancellable", "Final");
    if (!canStudentCancel(r)) throw lrcError("lrc/too-late-to-cancel", "Too late");

    tx.update(ref, {
      status: "cancelled",
      updatedAt: serverTimestamp(),
      cancelledAt: serverTimestamp(),
      cancelledBy: uid
    });
    lockRefsFor(r).forEach(function (lockRef) { tx.delete(lockRef); });
  });
}

/* ---------- staff: reservation decisions ---------- */

var DECISIONS = {
  confirmed: { from: ["pending"], verb: "approved" },
  rejected:  { from: ["pending"], verb: "rejected" },
  completed: { from: ["confirmed"], verb: "marked as completed" },
  cancelled: { from: ["pending", "confirmed"], verb: "cancelled by LRC staff" }
};

function auditEntry(staff, action, targetType, targetId, summary, details) {
  return {
    action: action,
    actorUid: staff.uid,
    actorName: staff.name,
    targetType: targetType,
    targetId: targetId,
    summary: clip(summary),
    details: details || {},
    createdAt: serverTimestamp()
  };
}

// Approve, reject, complete, or cancel a reservation. Writes the change,
// releases the time slots when they stop being blocked, records an audit
// entry, and sends the student an in-app notification - all atomically.
export async function decideReservation(reservationId, status, staff, note) {
  var rule = DECISIONS[status];
  if (!rule) throw lrcError("lrc/stale", "Unknown status");
  var ref = doc(db, "reservations", reservationId);
  var auditRef = doc(collection(db, "auditLogs"));

  await runTransaction(db, async function (tx) {
    var snap = await tx.get(ref);
    if (!snap.exists()) throw lrcError("lrc/stale", "Missing");
    var r = snap.data();
    if (rule.from.indexOf(r.status) === -1) throw lrcError("lrc/stale", "Changed");

    var update = {
      status: status,
      updatedAt: serverTimestamp(),
      decidedAt: serverTimestamp(),
      decidedBy: staff.uid,
      decidedByName: staff.name,
      lastAuditId: auditRef.id
    };
    if (note) update.staffNote = note;
    if (status === "cancelled") {
      update.cancelledAt = serverTimestamp();
      update.cancelledBy = staff.uid;
    }

    tx.set(auditRef, auditEntry(staff, "reservation." + status, "reservation", reservationId,
      r.studentName + " (" + r.studentNo + "): " + describeBooking(r) + " " + rule.verb,
      { from: r.status, to: status, resourceId: r.resourceId, date: r.date,
        startHour: r.startHour, endHour: r.endHour, note: note || "" }));
    tx.update(ref, update);
    if (status !== "confirmed") {
      lockRefsFor(r).forEach(function (lockRef) { tx.delete(lockRef); });
    }
    tx.set(doc(collection(db, "notifications")), {
      userId: r.userId,
      message: clip("Your reservation for " + describeBooking(r) + " was " + rule.verb + "."
             + (note ? " Note from staff: " + note : "")),
      reservationId: reservationId,
      kind: status,
      read: false,
      createdAt: serverTimestamp()
    });
  });
}

/* ---------- staff: units and schedule ---------- */

// Upcoming pending/confirmed reservations for one unit.
export async function upcomingReservationsFor(resourceId) {
  var snap = await getDocs(query(collection(db, "reservations"),
    where("resourceId", "==", resourceId), where("date", ">=", manilaDateISO())));
  var now = Date.now();
  return snap.docs
    .map(function (d) { return Object.assign({ id: d.id }, d.data()); })
    .filter(function (r) {
      return ACTIVE_STATUSES.indexOf(r.status) !== -1 && millis(r.end) > now;
    });
}

var STATUS_ACTIONS = {
  active: "resource.reopened",
  maintenance: "resource.maintenance",
  removed: "resource.removed"
};

// status: "active" | "maintenance" | "removed". Removal is refused while
// the unit has upcoming reservations; the record itself is kept.
export async function setResourceStatus(resource, status, staff, note) {
  if (status === "removed") {
    var upcoming = await upcomingReservationsFor(resource.id);
    if (upcoming.length) {
      throw lrcError("lrc/has-future-reservations", "Has reservations", { reservations: upcoming });
    }
  }
  var auditRef = doc(collection(db, "auditLogs"));
  var batch = writeBatch(db);
  var verbs = { active: "reopened", maintenance: "marked unavailable (maintenance/closure)",
                removed: "removed from active use" };
  batch.set(auditRef, auditEntry(staff, STATUS_ACTIONS[status], "resource", resource.id,
    resource.label + " (" + resource.facilityName + ") " + verbs[status]
      + (note ? ": " + note : ""),
    { from: resource.status, to: status, note: note || "" }));
  var update = {
    status: status,
    statusNote: note || "",
    updatedAt: serverTimestamp(),
    updatedBy: staff.uid,
    lastAuditId: auditRef.id
  };
  if (status === "removed") {
    update.removedAt = serverTimestamp();
    batch.delete(doc(db, "resourceLabels", resource.facilityId + "_" + resource.number));
  }
  batch.update(doc(db, "resources", resource.id), update);
  await batch.commit();
}

// Lowest number not used by an active or maintenance unit, so a removed
// unit's number can be reused under a brand-new stable id.
export function nextUnitNumber(facilityId, resources) {
  var used = {};
  resources.forEach(function (r) {
    if (r.facilityId === facilityId && r.status !== "removed") used[r.number] = true;
  });
  var n = 1;
  while (used[n]) n++;
  return n;
}

export async function addResource(facility, resources, staff) {
  var number = nextUnitNumber(facility.id, resources);
  var label = facility.unitPrefix + " " + number;
  var resourceRef = doc(collection(db, "resources"));
  var labelRef = doc(db, "resourceLabels", facility.id + "_" + number);
  var auditRef = doc(collection(db, "auditLogs"));

  await runTransaction(db, async function (tx) {
    var taken = await tx.get(labelRef);
    if (taken.exists()) throw lrcError("lrc/label-taken", "Label taken");
    tx.set(auditRef, auditEntry(staff, "resource.added", "resource", resourceRef.id,
      "Added " + label + " to " + facility.name, { number: number, label: label }));
    tx.set(resourceRef, newResourceData(facility, number, staff, auditRef.id));
    tx.set(labelRef, { resourceId: resourceRef.id });
  });
  return label;
}

function newResourceData(facility, number, staff, auditId) {
  return {
    facilityId: facility.id,
    facilityName: facility.name,
    type: facility.type,
    number: number,
    label: facility.unitPrefix + " " + number,
    capacity: facility.capacityPerUnit,
    status: "active",
    statusNote: "",
    createdAt: serverTimestamp(),
    createdBy: staff.uid,
    updatedAt: serverTimestamp(),
    updatedBy: staff.uid,
    removedAt: null,
    lastAuditId: auditId
  };
}

export async function saveSchedule(days, closedDates, staff, summary) {
  var auditRef = doc(collection(db, "auditLogs"));
  var batch = writeBatch(db);
  batch.set(auditRef, auditEntry(staff, "schedule.updated", "schedule", "schedule",
    summary || "Updated LRC operating hours", { days: days, closedDates: closedDates }));
  batch.set(doc(db, "config", "schedule"), {
    timezone: TIMEZONE,
    utcOffsetHours: UTC_OFFSET_HOURS,
    days: days,
    closedDates: closedDates,
    updatedAt: serverTimestamp(),
    updatedBy: staff.uid,
    lastAuditId: auditRef.id
  });
  await batch.commit();
}

// One-time setup run by an admin from the staff dashboard: creates the
// three facilities, the 28 initial units, and the operating schedule.
// Safe to run again - anything that already exists is left alone.
export async function initializeInventory(staff, onProgress) {
  var report = onProgress || function () {};

  for (var f = 0; f < INITIAL_FACILITIES.length; f++) {
    var fac = INITIAL_FACILITIES[f];
    var facRef = doc(db, "facilities", fac.id);
    if (!(await getDoc(facRef)).exists()) {
      var batch = writeBatch(db);
      batch.set(facRef, {
        name: fac.name, alias: fac.alias, type: fac.type, unitPrefix: fac.unitPrefix,
        capacityPerUnit: fac.capacityPerUnit, description: fac.description,
        image: fac.image, order: fac.order, updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "auditLogs")), auditEntry(staff, "facility.created",
        "facility", fac.id, "Created facility " + fac.name));
      await batch.commit();
    }
  }

  var scheduleRef = doc(db, "config", "schedule");
  if (!(await getDoc(scheduleRef)).exists()) {
    await saveSchedule(INITIAL_SCHEDULE.days, [], staff,
      "Set initial LRC hours: Mon-Fri 7:00 AM-7:00 PM, Sat 8:00 AM-4:00 PM, Sun closed");
  }

  var existing = await getDocs(collection(db, "resources"));
  var have = {};
  existing.docs.forEach(function (d) { have[d.id] = true; });

  var pending = [];
  INITIAL_FACILITIES.forEach(function (facility) {
    for (var n = 1; n <= facility.initialUnits; n++) {
      var id = facility.unitIdPrefix + n;
      if (!have[id]) pending.push({ facility: facility, number: n, id: id });
    }
  });

  // Small batches keep each write within the Security Rules lookup limits.
  for (var i = 0; i < pending.length; i += 4) {
    var chunk = pending.slice(i, i + 4);
    var unitBatch = writeBatch(db);
    chunk.forEach(function (u) {
      var auditRef = doc(collection(db, "auditLogs"));
      var label = u.facility.unitPrefix + " " + u.number;
      unitBatch.set(auditRef, auditEntry(staff, "resource.added", "resource", u.id,
        "Added " + label + " to " + u.facility.name + " (initial inventory)",
        { number: u.number, label: label }));
      unitBatch.set(doc(db, "resources", u.id),
        newResourceData(u.facility, u.number, staff, auditRef.id));
      unitBatch.set(doc(db, "resourceLabels", u.facility.id + "_" + u.number), { resourceId: u.id });
    });
    await unitBatch.commit();
    report(Math.min(i + 4, pending.length), pending.length);
  }
  return pending.length;
}
