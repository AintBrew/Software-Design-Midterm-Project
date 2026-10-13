# Firebase setup — NU Fairview LRC Booking System

The site is plain HTML/CSS/JS. It loads the Firebase Web SDK (v10.14.1, modular) straight from
`www.gstatic.com`, so it needs no build step. All Firebase code lives in this folder:

| File | Purpose |
| --- | --- |
| `firebase-config.js` | The only Firebase entry point: project config, initialization, sign-up/sign-in, role checks, and every Firestore read/write the pages use. |
| `firestore.rules` | Security Rules. These are the real enforcement layer. |
| `firestore.indexes.json` | The one composite index the app needs. |
| `tests/` | Security Rules tests that run against the local emulator. |

`firebase.json` and `.firebaserc` in the project root point the Firebase CLI at these files and at
the `lrc-project` Firebase project (`lrc-project-de364`).

## 1. Project configuration

`FIREBASE_CONFIG` at the top of `firebase-config.js` holds the public web-app config for the
**LRC Booking Web** app in `lrc-project-de364`. These values only identify the project; they are not
secrets. Access is controlled by `firestore.rules`.

To use a different Firebase project:

1. In the Firebase console, open **Project settings → Your apps → Add app → Web**, then copy the config object.
2. Replace `FIREBASE_CONFIG` with it, and change `default` in `.firebaserc` to the new project ID.

Never commit service-account keys or Admin SDK credentials. The site does not use them.

## 2. One-time project setup

Already done for `lrc-project-de364`. Repeat these steps for a new project.

1. **Authentication:** console → *Build → Authentication → Sign-in method* → enable **Email/Password**.
2. **Firestore:** console → *Build → Firestore Database → Create database* in production mode. Use
   `asia-southeast1` (Singapore), the closest region to Manila.
3. **Deploy rules and indexes** from the project root:

   ```
   npx firebase-tools login
   npx firebase-tools deploy --only firestore
   ```

   The index (`reservations`: `resourceId` ASC + `date` ASC) takes a few minutes to build. Until
   it's ready, staff can't remove units: the app shows "missing index".

## 3. Provisioning staff and administrators

Sign-up only ever creates `student` profiles. The rules reject any other role, and users can't
change their own role. To add an LRC staff member or administrator:

1. Console → *Authentication → Users → Add user*. Enter their NU Fairview e-mail and a temporary
   password, then copy the new **User UID**.
2. Console → *Firestore → Start collection / Add document* in `users`. Use the UID as the document ID,
   with these fields:
   - `role` (string): `admin` or `staff`
   - `name` (string): e.g. `Ma. Teresa Lim`
   - `email` (string): the same e-mail
   - `title` (string, optional): e.g. `LRC Supervisor / Administrator`
3. They sign in on the normal login page and land on the staff dashboard.

The console writes with administrator privileges, so this bypasses the rules on purpose. Only
project owners and editors can do it.

## 4. First run: create the LRC inventory

Sign in as an admin. On an empty database the staff dashboard shows **Set up the LRC inventory**.
Clicking it creates:

- facilities: Discussion Rooms (4 rooms, 8 people each), Silent Area (10 seats), and Electronic
  Library / Computer Area (14 computers)
- 28 units with stable IDs: `discussion-room-1..4`, `silent-seat-1..10`, `computer-1..14`
- the schedule: Mon–Fri 7:00 AM–7:00 PM, Sat 8:00 AM–4:00 PM, Sunday closed (NU Fairview time)

It is safe to run again; anything that already exists is kept.

## 5. Running the site locally

ES modules don't load from `file://`, so serve the project root over HTTP:

```
python -m http.server 5500
```

Then open <http://localhost:5500/login/login.html>. `npx serve .` or VS Code Live Server also work.

### Using the emulators instead of the live project

```
cd firebase/tests
npm install
npx firebase emulators:start --only auth,firestore --config ../../firebase.json
```

Open any page once with `?emulator=1` (for example
`http://localhost:5500/login/login.html?emulator=1`). That browser tab then talks to the local
emulators; use `?emulator=0` to switch back. Create the first admin in the emulator through its REST
API, as `firebase/tests` does, or temporarily through the Emulator UI.

### Rules tests

```
cd firebase/tests
npm install
npm test
```

This runs 37 Security Rules tests against the Firestore emulator under the `demo-lrc-booking`
project ID, so it never touches the live project. Java 11+ is required.

## 6. Data model

All times are NU Fairview local time (Asia/Manila, UTC+8, no daylight saving). `date` fields are
`"YYYY-MM-DD"`, hours are integers 0–24, and `start`/`end` are the matching Firestore timestamps.

| Collection / document | Fields | Who can read / write |
| --- | --- | --- |
| `users/{uid}` | `role` (`student`/`staff`/`admin`), `name`, `studentNo`, `program`, `email`, `username?`, `createdAt`, `updatedAt` | Owner and staff read. Students create their own `student` profile and may edit `name`, `program`, `username`. |
| `studentNumbers/{studentNo}` | `uid` | Created with the profile; guarantees unique student numbers. Never updated. |
| `facilities/{facilityId}` | `name`, `alias`, `type` (`discussion`/`silent`/`computer`), `unitPrefix`, `capacityPerUnit`, `description`, `image`, `order` | Signed-in users read; staff write. |
| `resources/{resourceId}` | `facilityId`, `facilityName`, `type`, `number`, `label` (e.g. `Computer number 15`), `capacity`, `status` (`active`/`maintenance`/`removed`), `statusNote`, `createdAt/By`, `updatedAt/By`, `removedAt`, `lastAuditId` | Signed-in users read; staff create/update (each change paired with an audit entry). Never deleted: removed units stay for history. |
| `resourceLabels/{facilityId}_{number}` | `resourceId` | Exists while a non-removed unit uses that number, keeping labels unique. Deleted on removal so the number can be reused under a new stable ID. Staff only. |
| `config/schedule` | `timezone`, `utcOffsetHours`, `days` (`"1"`=Mon … `"7"`=Sun → `{open, openHour, closeHour}`), `closedDates[]`, `updatedAt/By`, `lastAuditId` | Signed-in users read; staff write. |
| `reservations/{id}` | `userId`, `studentName`, `studentNo`, `resourceId`, `resourceLabel`, `facilityId`, `facilityName`, `facilityType`, `capacity`, `location`, `date`, `startHour`, `endHour`, `start`, `end`, `purpose`, `attendees[{name, studentNo}]` (excludes the booker), `groupSize` (= attendees + 1), `status`, `createdAt`, `updatedAt`, plus decision/cancellation fields | Owner and staff only (attendee details stay private). |
| `slotLocks/{resourceId}_{date}_{hour}` | `resourceId`, `date`, `hour`, `reservationId` | Readable by signed-in users (no personal data) for live availability; written only together with the matching reservation change. |
| `notifications/{id}` | `userId`, `message`, `reservationId`, `kind`, `read`, `createdAt` | Recipient only. In-app only; nothing is e-mailed or pushed. |
| `auditLogs/{id}` | `action`, `actorUid`, `actorName`, `targetType`, `targetId`, `summary`, `details`, `createdAt` | Staff only. Append-only. |

### How the rules keep the data consistent

- **No double booking.** Every booked hour owns a `slotLocks` document whose ID is derived from
  unit + date + hour. A reservation can only be created in the same write as its locks, and a lock
  can only be *created*, never overwritten, so a second booking for any overlapping hour fails.
  The client also re-checks the locks inside a transaction and shows "Someone else just booked…"
  when another student wins the race.
- **Booking rules** checked server-side on create:
  - the student's identity matches their profile
  - the unit is `active`
  - the booking is 1–2 contiguous hours, in the future, and inside that day's hours from `config/schedule`
  - the date isn't in `closedDates`
  - the group (attendees + 1) fits the unit's capacity, and every attendee has a name and a valid student number
  - the status starts as `pending`
- **Status transitions:**
  - Students: `pending|confirmed → cancelled`, only on their own booking and only until 1 hour before the start.
  - Staff: `pending → confirmed|rejected|cancelled` and `confirmed → completed|cancelled`.
  - Every transition except approval must release the slot locks in the same write, so rejected, cancelled and completed bookings stop blocking availability.
- **Audit trail.** Staff changes to reservations, units and the schedule must carry a
  `lastAuditId` pointing at an audit entry written in the same request by the same user.
- **Unit removal.** A unit can be removed only after it has no upcoming pending/confirmed
  reservations; the dashboard offers to cancel them first, and each student is notified. Its
  `resources` document and reservation history are kept.

### Queries and indexes

| Page | Query | Index |
| --- | --- | --- |
| Student pages | `reservations` / `notifications` where `userId == uid` | single-field (automatic) |
| Availability | `slotLocks` where `date == D` | automatic |
| Staff dashboard / reports | `reservations` where `date >= A && date <= B` order by `date`; `status == "pending"` | automatic |
| Unit removal check | `reservations` where `resourceId == R && date >= today` | **composite**, in `firestore.indexes.json` |
| Activity log | `auditLogs` order by `createdAt desc` limit 50 | automatic |

## 7. Known limits

- E-mail ownership isn't verified. Anyone can register with an address ending in
  `nu-fairview.edu.ph`. To require verification, call `sendEmailVerification` after sign-up and add
  `request.auth.token.email_verified == true` to the rules.
- Password resets are handled by LRC staff in the Firebase console (*Authentication → Users → Reset
  password*). The login page says so.
- Without Cloud Functions, nothing marks bookings "completed" automatically. Staff mark them done.
  Past pending/confirmed bookings move to the student's history either way.
