/* ============================================================
   sign_up.js - student registration for the NU Fairview LRC
   Study Area Online Booking System.

   Credentials go to Firebase Authentication; the profile (name,
   student number, program, e-mail, optional username) goes to
   Cloud Firestore through firebase/firebase-config.js.
   ============================================================ */

import { registerStudent, describeError } from "../firebase/firebase-config.js";

var form      = document.getElementById("signupForm");
var card      = document.querySelector(".auth-card");
var submitBtn = document.getElementById("submitBtn");
var peekBtn   = document.getElementById("peekBtn");
var passInput = document.getElementById("password");

var FIELDS = ["fullName", "studentNo", "program", "email", "username",
              "password", "confirm", "agree"];

/* ---------- error helpers ---------- */

function showError(id, message) {
  var input = document.getElementById(id);
  var slot  = document.getElementById(id + "Err");
  if (input && input.type !== "checkbox") input.classList.add("bad");
  if (slot) {
    slot.textContent = message;
    slot.classList.add("show");
  }
}

function clearErrors() {
  for (var i = 0; i < FIELDS.length; i++) {
    var input = document.getElementById(FIELDS[i]);
    var slot  = document.getElementById(FIELDS[i] + "Err");
    if (input) input.classList.remove("bad");
    if (slot) {
      slot.textContent = "";
      slot.classList.remove("show");
    }
  }
  var formSlot = document.getElementById("formErr");
  formSlot.textContent = "";
  formSlot.classList.remove("show");
}

function showFormError(message) {
  var formSlot = document.getElementById("formErr");
  formSlot.textContent = message;
  formSlot.classList.add("show");

  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
}

// clear a field's error as soon as it is edited
FIELDS.forEach(function (id) {
  var input = document.getElementById(id);
  if (!input) return;
  var event = (input.tagName === "SELECT" || input.type === "checkbox") ? "change" : "input";
  input.addEventListener(event, function () {
    input.classList.remove("bad");
    var slot = document.getElementById(id + "Err");
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

/* ---------- password strength meter ---------- */

var meter      = document.getElementById("meter");
var meterLabel = document.getElementById("meterLabel");

function scorePassword(value) {
  if (!value) return 0;
  var score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  if (score > 3) score = 3;
  return score;
}

passInput.addEventListener("input", function () {
  var value = passInput.value;
  var score = scorePassword(value);

  meter.className = "meter" + (score ? " s" + score : "");
  meterLabel.className = "meter-label" + (score ? " s" + score : "");

  if (!value) {
    meterLabel.textContent = "Use 8 or more characters.";
  } else if (value.length < 8) {
    meterLabel.textContent = "Too short - use at least 8 characters.";
  } else if (score === 1) {
    meterLabel.textContent = "Weak - add numbers or capital letters.";
  } else if (score === 2) {
    meterLabel.textContent = "Fair - a symbol would make it stronger.";
  } else {
    meterLabel.textContent = "Strong password.";
  }
});

/* ---------- policy dialog ---------- */

var policyVeil = document.getElementById("policyVeil");

document.getElementById("policyLink").addEventListener("click", function (e) {
  e.preventDefault();
  policyVeil.hidden = false;
  document.getElementById("policyClose").focus();
});

document.getElementById("policyClose").addEventListener("click", function () {
  policyVeil.hidden = true;
});

policyVeil.addEventListener("click", function (e) {
  if (e.target === policyVeil) policyVeil.hidden = true;
});

/* ---------- validation ---------- */

function validate() {
  var v = {
    fullName:  document.getElementById("fullName").value.trim(),
    studentNo: document.getElementById("studentNo").value.trim(),
    program:   document.getElementById("program").value,
    email:     document.getElementById("email").value.trim(),
    username:  document.getElementById("username").value.trim(),
    password:  document.getElementById("password").value,
    confirm:   document.getElementById("confirm").value,
    agree:     document.getElementById("agree").checked
  };

  var firstBad = null;

  function fail(id, message) {
    showError(id, message);
    if (!firstBad) firstBad = id;
  }

  if (v.fullName.length < 3) {
    fail("fullName", "Enter your full name as it appears on your student record.");
  }

  if (!v.studentNo) {
    fail("studentNo", "Enter your student number.");
  } else if (!/^\d{4}-\d{6}$/.test(v.studentNo)) {
    fail("studentNo", "Use the format 2023-123456 - four digits, a dash, then six digits.");
  }

  if (!v.program) {
    fail("program", "Select your program.");
  }

  if (!v.email) {
    fail("email", "Enter your NU Fairview e-mail address.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    fail("email", "That does not look like a valid e-mail address.");
  } else if (!/@([a-z0-9-]+\.)*nu-fairview\.edu\.ph$/i.test(v.email)) {
    fail("email", "Use your NU Fairview address, ending in nu-fairview.edu.ph.");
  }

  // username is optional profile information only
  if (v.username) {
    if (v.username.length < 4 || v.username.length > 30) {
      fail("username", "Usernames need 4 to 30 characters, or leave it blank.");
    } else if (!/^[A-Za-z0-9._]+$/.test(v.username)) {
      fail("username", "Use letters, numbers, dots, and underscores only.");
    }
  }

  if (!v.password) {
    fail("password", "Choose a password.");
  } else if (v.password.length < 8) {
    fail("password", "Passwords must be at least 8 characters long.");
  }

  if (!v.confirm) {
    fail("confirm", "Re-enter your password.");
  } else if (v.confirm !== v.password) {
    fail("confirm", "The two passwords do not match.");
  }

  if (!v.agree) {
    fail("agree", "You need to agree to the LRC reservation policies to continue.");
  }

  return { values: v, firstBad: firstBad };
}

/* ---------- submit ---------- */

form.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearErrors();

  var check = validate();

  if (check.firstBad) {
    showFormError("Some details still need fixing. Check the highlighted fields below.");
    var target = document.getElementById(check.firstBad);
    if (target) target.focus();
    return;
  }

  submitBtn.classList.add("busy");
  submitBtn.disabled = true;

  var v = check.values;
  try {
    var email = await registerStudent({
      name:      v.fullName,
      studentNo: v.studentNo,
      program:   v.program,
      email:     v.email,
      username:  v.username,
      password:  v.password
    });

    NU.toast("Account created for " + v.fullName + ".", "good");

    // hand off to the login page with the e-mail filled in
    window.location.href = "../login/login.html?registered=1&e=" + encodeURIComponent(email);
  } catch (err) {
    submitBtn.classList.remove("busy");
    submitBtn.disabled = false;

    var code = err && err.code;
    var message = describeError(err);
    if (code === "lrc/student-number-taken") {
      showError("studentNo", message);
      document.getElementById("studentNo").focus();
    } else if (code === "auth/email-already-in-use" || code === "auth/invalid-email") {
      showError("email", message);
      document.getElementById("email").focus();
    } else if (code === "auth/weak-password") {
      showError("password", message);
      passInput.focus();
    }
    showFormError("Your account was not created. " + message);
  }
});

document.getElementById("fullName").focus();
