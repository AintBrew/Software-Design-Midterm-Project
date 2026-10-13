/* ============================================================
   NU Fairview LRC Study Area Online Booking System
   shared/nu-data.js

   Display helpers shared by every page: NU Fairview dates and
   times, labels, badges, and the toast. All data (accounts,
   facilities, units, reservations) lives in Cloud Firestore and
   is reached through firebase/firebase-config.js.
   ============================================================ */

var NU = (function () {

  // NU Fairview is UTC+8 all year; dates are shown in that time
  // no matter which time zone the visitor's device uses.
  var OFFSET_MS = 8 * 3600 * 1000;

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday",
              "Thursday", "Friday", "Saturday"];

  /* ---- Dates ----------------------------------------------- */

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // ms since epoch -> "YYYY-MM-DD" at NU Fairview
  function isoFromMs(ms) {
    var d = new Date(ms + OFFSET_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function todayISO() {
    return isoFromMs(Date.now());
  }

  // current hour (0-23) at NU Fairview
  function nowHour() {
    return new Date(Date.now() + OFFSET_MS).getUTCHours();
  }

  function parts(iso) {
    var p = iso.split("-");
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }

  function toISO(year, monthIndex, day) {
    return year + "-" + pad(monthIndex + 1) + "-" + pad(day);
  }

  function shiftISO(iso, days) {
    var d = parts(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toISO(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  // 0 = Sunday ... 6 = Saturday
  function weekday(iso) {
    return parts(iso).getUTCDay();
  }

  // "2026-08-30" -> "Sunday, August 30, 2026"
  function fmtDateLong(iso) {
    var d = parts(iso);
    return DAYS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " "
         + d.getUTCDate() + ", " + d.getUTCFullYear();
  }

  // "2026-08-30" -> "Sun, Aug 30"
  function fmtDateShort(iso) {
    var d = parts(iso);
    return DAYS[d.getUTCDay()].slice(0, 3) + ", " + MONTHS[d.getUTCMonth()].slice(0, 3)
         + " " + d.getUTCDate();
  }

  // 13 -> "1:00 PM"
  function fmtHour(h) {
    var suffix = h >= 12 && h < 24 ? "PM" : "AM";
    var hour = h % 12;
    if (hour === 0) hour = 12;
    return hour + ":00 " + suffix;
  }

  // (13, 15) -> "1:00 PM - 3:00 PM"
  function fmtRange(startHour, endHour) {
    return fmtHour(startHour) + " - " + fmtHour(endHour === undefined ? startHour + 1 : endHour);
  }

  function fmtDuration(hours) {
    return hours + (hours === 1 ? " Hour" : " Hours");
  }

  // Firestore Timestamp (or ms) -> "Oct 12, 2026, 3:05 PM" at NU Fairview
  function fmtStamp(value) {
    var ms = value && typeof value.toMillis === "function" ? value.toMillis() : Number(value);
    if (!ms) return "just now";
    var d = new Date(ms + OFFSET_MS);
    var h = d.getUTCHours();
    var suffix = h >= 12 ? "PM" : "AM";
    var hour = h % 12 || 12;
    return MONTHS[d.getUTCMonth()].slice(0, 3) + " " + d.getUTCDate() + ", "
         + d.getUTCFullYear() + ", " + hour + ":" + pad(d.getUTCMinutes()) + " " + suffix;
  }

  /* ---- Reservation labels ---------------------------------- */

  var STATUS_TEXT = {
    pending: "Pending",
    confirmed: "Confirmed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    completed: "Completed"
  };

  var STATUS_BADGE = {
    pending: "badge-warn",
    confirmed: "badge-ok",
    rejected: "badge-danger",
    cancelled: "badge-danger",
    completed: "badge-mute"
  };

  function statusBadge(status) {
    return '<span class="badge ' + (STATUS_BADGE[status] || "badge-mute") + '">'
         + (STATUS_TEXT[status] || escapeHtml(status)) + '</span>';
  }

  function capacityText(capacity) {
    return capacity === 1 ? "1 person" : "Up to " + capacity + " people";
  }

  /* ---- Small shared helpers -------------------------------- */

  function toast(message, kind) {
    var box = document.getElementById("toast");
    if (!box) return;
    box.textContent = message;
    box.className = "show" + (kind ? " " + kind : "");
    box.setAttribute("role", kind === "bad" ? "alert" : "status");
    clearTimeout(box._timer);
    box._timer = setTimeout(function () { box.className = ""; }, kind === "bad" ? 6000 : 3600);
  }

  // nav items whose pages are not built yet
  function bindSoon(message) {
    var soon = document.querySelectorAll("[data-soon]");
    for (var i = 0; i < soon.length; i++) {
      soon[i].addEventListener("click", function (e) {
        e.preventDefault();
        toast(message || "That page is part of the next batch.");
      });
    }
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  return {
    MONTHS: MONTHS,
    DAYS: DAYS,
    STATUS_TEXT: STATUS_TEXT,

    isoFromMs: isoFromMs,
    todayISO: todayISO,
    nowHour: nowHour,
    toISO: toISO,
    shiftISO: shiftISO,
    weekday: weekday,
    fmtDateLong: fmtDateLong,
    fmtDateShort: fmtDateShort,
    fmtHour: fmtHour,
    fmtRange: fmtRange,
    fmtDuration: fmtDuration,
    fmtStamp: fmtStamp,

    statusBadge: statusBadge,
    capacityText: capacityText,

    toast: toast,
    bindSoon: bindSoon,
    escapeHtml: escapeHtml
  };
})();
