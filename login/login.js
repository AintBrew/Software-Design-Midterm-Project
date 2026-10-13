/* ============================================================
   login.js - sign in behaviour for the NU Fairview LRC
   Study Area Online Booking System.

   Students and staff sign in with their NU Fairview e-mail and
   password through Firebase Authentication.
   ============================================================ */

import {
  signInUser, currentProfile, describeError, HOME
} from "../firebase/firebase-config.js";

var form      = document.getElementById("loginForm");
var card      = document.querySelector(".auth-card");
var emailInput = document.getElementById("email");
var passInput = document.getElementById("password");
var remember  = document.getElementById("remember");
var submitBtn = document.getElementById("submitBtn");
var peekBtn   = document.getElementById("peekBtn");

var veil         = document.getElementById("successVeil");
var successTitle = document.getElementById("successTitle");
var successBody  = document.getElementById("successBody");
var successNote  = document.getElementById("successNote");

/* ---------- error helpers ---------- */

function showError(inputId, message) {
  var input = document.getElementById(inputId);
  var slot  = document.getElementById(inputId + "Err");
  if (input) input.classList.add("bad");
  if (slot) {
    slot.textContent = message;
    slot.classList.add("show");
  }
}

function shake() {
  card.classList.remove("shake");
  void card.offsetWidth;          // restart the animation
  card.classList.add("shake");
}

function showFormError(message) {
  var slot = document.getElementById("formErr");
  slot.textContent = message;
  slot.classList.add("show");
  shake();
}

function clearErrors() {
  ["email", "password"].forEach(function (id) {
    var input = document.getElementById(id);
    var slot  = document.getElementById(id + "Err");
    input.classList.remove("bad");
    slot.textContent = "";
    slot.classList.remove("show");
  });
  var formSlot = document.getElementById("formErr");
  formSlot.textContent = "";
  formSlot.classList.remove("show");
}

// clear a field's error as soon as the student edits it
[emailInput, passInput].forEach(function (input) {
  input.addEventListener("input", function () {
    input.classList.remove("bad");
    var slot = document.getElementById(input.id + "Err");
    slot.textContent = "";
    slot.classList.remove("show");
  });
});

/* ---------- show / hide password ---------- */

peekBtn.addEventListener("click", function () {
  var hidden = passInput.type === "password";
  passInput.type = hidden ? "text" : "password";
  peekBtn.textContent = hidden ? "Hide" : "Show";
  peekBtn.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
  peekBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
  passInput.focus();
});

/* ---------- forgot password (handled by LRC staff) ---------- */

document.getElementById("forgotLink").addEventListener("click", function (e) {
  e.preventDefault();
  NU.toast("Password resets are handled at the LRC counter for now.");
});

/* ---------- submit ---------- */

function setBusy(busy) {
  submitBtn.classList.toggle("busy", busy);
  submitBtn.disabled = busy;
}

form.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearErrors();

  var email = emailInput.value.trim();
  var password = passInput.value;
  var bad = false;

  if (!email) {
    showError("email", "Enter your NU Fairview e-mail to continue.");
    bad = true;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("email", "That does not look like a valid e-mail address.");
    bad = true;
  }
  if (!password) {
    showError("password", "Enter your password to continue.");
    bad = true;
  }
  if (bad) {
    shake();
    return;
  }

  setBusy(true);
  try {
    var profile = await signInUser(email, password, remember.checked);
    openSuccess(profile);
  } catch (err) {
    setBusy(false);
    var code = err && err.code;
    if (code === "auth/wrong-password") {
      showError("password", describeError(err));
      passInput.focus();
    } else if (code === "auth/user-not-found" || code === "auth/invalid-email") {
      showError("email", describeError(err));
      emailInput.focus();
    }
    showFormError("Sign in failed. " + describeError(err)
      + (code === "lrc/no-profile" && err.uid ? " Account UID: " + err.uid : ""));
  }
});

/* ---------- success panel ---------- */

function openSuccess(profile) {
  var first = profile.name.split(" ")[0];
  var where = profile.role === "student"
    ? "your student dashboard"
    : "the LRC staff dashboard";

  successTitle.textContent = "Welcome back, " + first;
  successBody.textContent  = "Signed in as " + profile.name + " - opening " + where + "...";
  successNote.textContent  = "";
  successNote.hidden = true;

  veil.hidden = false;
  NU.toast("Signed in as " + profile.name, "good");

  // let the tick finish drawing, then go to the dashboard
  setTimeout(function () {
    window.location.href = HOME[profile.role];
  }, 900);
}

/* ---------- on load ---------- */

var params = new URLSearchParams(window.location.search);
if (params.get("registered") === "1") {
  // a student sent here from the sign up page
  emailInput.value = params.get("e") || "";
  NU.toast("Account created. Sign in to continue.", "good");
  passInput.focus();
} else {
  emailInput.focus();
}
if (params.get("noprofile") === "1") {
  showFormError(describeError({ code: "lrc/no-profile" }));
}

// Already signed in from an earlier visit: go straight to the dashboard.
currentProfile().then(function (profile) {
  if (profile && HOME[profile.role] && params.get("registered") !== "1") {
    window.location.replace(HOME[profile.role]);
  }
}).catch(function () { /* stay on the sign in form */ });
