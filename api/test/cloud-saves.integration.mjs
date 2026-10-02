// End-to-end Cloud Saves v2 integration test against a live self-hosted backend.
// Exercises the exact request sequence the launcher performs.
import assert from "node:assert/strict";
import crypto from "node:crypto";

const BASE = process.env.ITEST_BASE ?? "http://127.0.0.1:3999";
const INSTANCE_TOKEN = process.env.ITEST_TOKEN ?? "itest-secret";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const log = (...a) => console.log(...a);

const req = async (method, path, { token, body, raw, headers = {} } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? {} : body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text };
};

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

log("=== instance verification ===");
const verify = await req("POST", "/auth/verify-instance", {
  body: { token: INSTANCE_TOKEN },
});
check("POST /auth/verify-instance accepts the instance token", () =>
  assert.equal(verify.body?.valid, true)
);

log("\n=== account ===");
const username = `itest_${Date.now()}`;
const register = await req("POST", "/auth/register", {
  body: { username, password: "itest-password-123" },
  headers: { Authorization: `Bearer ${INSTANCE_TOKEN}` },
});
if (register.status >= 400) {
  log(`  (register -> ${register.status} ${register.text.slice(0, 200)})`);
}
const login = await req("POST", "/auth/login", {
  body: { username, password: "itest-password-123" },
  headers: { Authorization: `Bearer ${INSTANCE_TOKEN}` },
});
const token =
  register.body?.accessToken ??
  register.body?.token ??
  login.body?.accessToken ??
  login.body?.token;
check("register/login returns an access token", () =>
  assert.ok(token, `no token (register=${register.status} login=${login.status})`)
);
if (!token) {
  log("\nCannot continue without a token.");
  process.exit(1);
}

const shop = "steam";
const objectId = "440";

log("\n=== cloud saves v2: upload ===");
// Two files, one duplicated content to exercise blob de-duplication.
const fileA = Buffer.from("SAVE-SLOT-A: progress=42\n");
const fileB = Buffer.from("SAVE-SLOT-B: progress=7\n");
const variantId = sha256(Buffer.from("default-variant"));
const files = [
  {
    variantId,
    rawPath: "<winAppData>/game/slot-a.sav",
    relativePath: "slot-a.sav",
    hash: sha256(fileA),
    sizeBytes: fileA.length,
    lastModifiedAt: new Date().toISOString(),
  },
  {
    variantId,
    rawPath: "<winAppData>/game/slot-b.sav",
    relativePath: "slot-b.sav",
    hash: sha256(fileB),
    sizeBytes: fileB.length,
    lastModifiedAt: new Date().toISOString(),
  },
];
const snapshotHash = sha256(Buffer.from(files.map((f) => f.hash).join("")));

const prepare = await req("POST", "/profile/cloud-saves/prepare-snapshot", {
  token,
  body: {
    shop,
    objectId,
    platform: "linux",
    hostname: "itest-host",
    snapshotHash,
    baseVersion: 0,
    customPathRawPaths: [],
    variants: [{ variantId, kind: "default" }],
    files,
  },
});
check("prepare-snapshot returns a pending id", () =>
  assert.ok(prepare.body?.pendingSnapshotId, JSON.stringify(prepare.body))
);
check("prepare-snapshot asks to upload both new blobs", () =>
  assert.equal(
    prepare.body?.files?.filter((f) => f.status === "upload").length,
    2
  )
);

for (const [index, buf] of [fileA, fileB].entries()) {
  const entry = prepare.body.files[index];
  const put = await req("PUT", entry.uploadUrl.replace(BASE, ""), {
    raw: buf,
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-checksum-sha256": Buffer.from(sha256(buf), "hex").toString("base64"),
    },
  });
  check(`blob ${index + 1} uploads (200)`, () => assert.equal(put.status, 200));
}

// Corrupted checksum must be rejected.
const badPut = await req(
  "PUT",
  prepare.body.files[0].uploadUrl.replace(BASE, ""),
  {
    raw: Buffer.from("corrupted"),
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-checksum-sha256": Buffer.from(sha256(fileA), "hex").toString("base64"),
    },
  }
);
check("upload with a mismatched checksum is rejected (400)", () =>
  assert.equal(badPut.status, 400)
);

const commit = await req("POST", "/profile/cloud-saves/commit-snapshot", {
  token,
  body: { pendingSnapshotId: prepare.body.pendingSnapshotId },
});
check("commit-snapshot succeeds", () => assert.equal(commit.status, 200));
check("commit returns version 1", () => assert.equal(commit.body?.version, 1));
check("commit reports both files", () =>
  assert.equal(commit.body?.fileCount, 2)
);

log("\n=== cloud saves v2: read back ===");
const snapshots = await req(
  "GET",
  `/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
  { token }
);
check("snapshots lists exactly one snapshot", () =>
  assert.equal(snapshots.body?.length, 1)
);
const summary = snapshots.body?.[0];
check("summary carries only the contract's keys", () =>
  assert.deepEqual(
    Object.keys(summary ?? {}).sort(),
    [
      "aggregateHash",
      "createdAt",
      "fileCount",
      "id",
      "totalSizeBytes",
      "updatedAt",
      "version",
    ]
  )
);
check("summary aggregateHash round-trips", () =>
  assert.equal(summary?.aggregateHash, snapshotHash)
);

const manifest = await req(
  "GET",
  `/profile/cloud-saves/snapshot-restore-manifest?snapshotId=${summary.id}`,
  { token }
);
check("restore manifest has snapshot/variants/files", () =>
  assert.deepEqual(
    Object.keys(manifest.body ?? {}).sort(),
    ["customPathRawPaths", "files", "snapshot", "variants"]
  )
);
check("manifest snapshot has only id/version/shop/objectId", () =>
  assert.deepEqual(
    Object.keys(manifest.body?.snapshot ?? {}).sort(),
    ["id", "objectId", "shop", "version"]
  )
);
check("manifest files match what was uploaded", () =>
  assert.deepEqual(
    manifest.body?.files?.map((f) => f.hash).sort(),
    files.map((f) => f.hash).sort()
  )
);

log("\n=== cloud saves v2: restore (download + verify bytes) ===");
const urls = await req(
  "GET",
  `/profile/cloud-saves/snapshot-download-urls?snapshotId=${summary.id}`,
  { token }
);
check("download-urls returns one entry per file", () =>
  assert.equal(urls.body?.length, 2)
);

for (const entry of urls.body ?? []) {
  const res = await fetch(entry.downloadUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  check(`downloaded blob ${entry.relativePath} matches its hash`, () =>
    assert.equal(sha256(buf), entry.hash)
  );
  const expected = entry.relativePath === "slot-a.sav" ? fileA : fileB;
  check(`downloaded ${entry.relativePath} is byte-identical`, () =>
    assert.equal(buf.toString(), expected.toString())
  );
}

log("\n=== failure handling ===");
const noAuth = await req(
  "GET",
  `/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`
);
check("snapshots without auth is rejected", () =>
  assert.ok(noAuth.status === 401 || noAuth.status === 403, `got ${noAuth.status}`)
);

const badBlob = await req(
  "GET",
  `/cloud-saves/download?token=bad-token&hash=${"0".repeat(64)}`
);
check("download with an invalid token is rejected (401)", () =>
  assert.equal(badBlob.status, 401)
);

const missingSnapshot = await req(
  "GET",
  "/profile/cloud-saves/snapshot-restore-manifest?snapshotId=does-not-exist",
  { token }
);
check("restore manifest for an unknown snapshot is 404", () =>
  assert.equal(missingSnapshot.status, 404)
);

const incomplete = await req("POST", "/profile/cloud-saves/prepare-snapshot", {
  token,
  body: {
    shop,
    objectId,
    snapshotHash: sha256(Buffer.from("never-uploaded")),
    baseVersion: 1,
    customPathRawPaths: [],
    variants: [{ variantId, kind: "default" }],
    files: [
      {
        variantId,
        rawPath: "<winAppData>/game/missing.sav",
        relativePath: "missing.sav",
        hash: sha256(Buffer.from("missing-content")),
        sizeBytes: 15,
        lastModifiedAt: new Date().toISOString(),
      },
    ],
  },
});
const incompleteCommit = await req(
  "POST",
  "/profile/cloud-saves/commit-snapshot",
  { token, body: { pendingSnapshotId: incomplete.body?.pendingSnapshotId } }
);
check("commit without uploading the blob is refused", () =>
  assert.equal(
    incompleteCommit.body?.error,
    "game/cloud-save-pending-snapshot-incomplete"
  )
);

log("\n=== second version + deletion ===");
const fileC = Buffer.from("SAVE-SLOT-A: progress=99\n");
const files2 = [
  {
    variantId,
    rawPath: "<winAppData>/game/slot-a.sav",
    relativePath: "slot-a.sav",
    hash: sha256(fileC),
    sizeBytes: fileC.length,
    lastModifiedAt: new Date().toISOString(),
  },
];
const prepare2 = await req("POST", "/profile/cloud-saves/prepare-snapshot", {
  token,
  body: {
    shop,
    objectId,
    snapshotHash: sha256(Buffer.from(files2.map((f) => f.hash).join(""))),
    baseVersion: 1,
    customPathRawPaths: [],
    variants: [{ variantId, kind: "default" }],
    files: files2,
  },
});
await req("PUT", prepare2.body.files[0].uploadUrl.replace(BASE, ""), {
  raw: fileC,
  headers: {
    "Content-Type": "application/octet-stream",
    "x-amz-checksum-sha256": Buffer.from(sha256(fileC), "hex").toString("base64"),
  },
});
const commit2 = await req("POST", "/profile/cloud-saves/commit-snapshot", {
  token,
  body: { pendingSnapshotId: prepare2.body.pendingSnapshotId },
});
check("second snapshot commits as version 2", () =>
  assert.equal(commit2.body?.version, 2)
);

const afterSecond = await req(
  "GET",
  `/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
  { token }
);
check("snapshots returns the newest version only", () =>
  assert.equal(afterSecond.body?.[0]?.version, 2)
);

const del = await req(
  "DELETE",
  `/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
  { token }
);
check("delete snapshots succeeds", () => assert.equal(del.status, 200));
const afterDelete = await req(
  "GET",
  `/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
  { token }
);
check("no snapshots remain after deletion", () =>
  assert.equal(afterDelete.body?.length, 0)
);

log("\n=== game visibility (new in 4.1.4) ===");
await req("POST", "/profile/games", {
  token,
  body: { objectId, shop, title: "Team Fortress 2", playTimeInMilliseconds: 0 },
});
const visibleBefore = await req("GET", "/profile/games?take=100&skip=0", { token });
check("new game appears in the visible library", () =>
  assert.ok(visibleBefore.body?.some?.((g) => g.objectId === objectId), JSON.stringify(visibleBefore.body).slice(0, 200))
);

const hiddenEmpty = await req("GET", "/profile/games/hidden?take=100&skip=0", { token });
check("GET /profile/games/hidden is implemented and returns an array", () =>
  assert.ok(Array.isArray(hiddenEmpty.body), `status ${hiddenEmpty.status}`)
);

const conceal = await req("PUT", `/profile/games/${shop}/${objectId}/conceal`, { token });
check("conceal returns the new visibility state", () =>
  assert.deepEqual(conceal.body, { isConcealed: true, isHiddenFromOthers: false })
);

const visibleAfter = await req("GET", "/profile/games?take=100&skip=0", { token });
const hiddenAfter = await req("GET", "/profile/games/hidden?take=100&skip=0", { token });
check("concealed game leaves the visible library", () =>
  assert.equal(visibleAfter.body?.some?.((g) => g.objectId === objectId), false)
);
check("concealed game appears in the hidden library", () =>
  assert.equal(hiddenAfter.body?.some?.((g) => g.objectId === objectId), true)
);

const unconceal = await req("DELETE", `/profile/games/${shop}/${objectId}/conceal`, { token });
check("unconceal restores visibility", () =>
  assert.deepEqual(unconceal.body, { isConcealed: false, isHiddenFromOthers: false })
);

const hide = await req("PUT", `/profile/games/${shop}/${objectId}/hide`, { token });
check("hide-from-others sets the flag", () =>
  assert.deepEqual(hide.body, { isConcealed: false, isHiddenFromOthers: true })
);
const publicLib = await req("GET", `/api/users/${username}/games`);
check("hidden-from-others game is absent from the public profile", () =>
  assert.equal(
    (publicLib.body?.games ?? publicLib.body ?? []).some?.((g) => g.objectId === objectId) ?? false,
    false
  )
);

const missingGame = await req("PUT", `/profile/games/${shop}/does-not-exist/conceal`, { token });
check("visibility on an unknown game returns game/not-found", () =>
  assert.equal(missingGame.body?.message, "game/not-found")
);

log("\n=== achievement souvenirs (new in 4.1.4) ===");
// The launcher asks for an upload authorization, PUTs the screenshot, sends the
// achievements with the souvenir attached, then reads the image back off them.
const me = await req("GET", "/profile/me", { token });
const myUserId = me.body?.id;
check("/profile/me returns a user id", () => assert.ok(myUserId));

const presign = await req("POST", "/presigned-urls/achievement-image", {
  token,
  body: {
    imageExt: "jpg",
    imageLength: 2048,
    remoteGameId: "rg-1",
    clientId: "souvenir-1",
  },
});
check("presigned-urls/achievement-image returns presignedUrl AND imageKey", () => {
  assert.ok(presign.body?.presignedUrl, JSON.stringify(presign.body));
  assert.ok(presign.body?.imageKey, "imageKey missing");
});

const jpeg = Buffer.from("\xff\xd8\xff\xe0FAKE-SOUVENIR-JPEG\xff\xd9", "binary");
const upload = await req("PUT", presign.body.presignedUrl.replace(BASE, ""), {
  raw: jpeg,
  headers: { "Content-Type": "image/jpeg" },
});
check("souvenir image uploads (200)", () => assert.equal(upload.status, 200));

// A souvenir upload must not touch the avatar or banner.
const afterUpload = await req("GET", "/profile/me", { token });
check("souvenir upload leaves the profile banner alone", () =>
  assert.equal(
    afterUpload.body?.backgroundImageUrl ?? null,
    me.body?.backgroundImageUrl ?? null
  )
);
check("souvenir upload leaves the avatar alone", () =>
  assert.equal(
    afterUpload.body?.profileImageUrl ?? null,
    me.body?.profileImageUrl ?? null
  )
);

const servedRes = await fetch(`${BASE}/achievement-images/${presign.body.imageKey}`);
const servedBytes = Buffer.from(await servedRes.arrayBuffer());
check("souvenir image is served back byte-identical", () =>
  assert.equal(servedBytes.toString("binary"), jpeg.toString("binary"))
);

const libraryRows = await req("GET", "/profile/games?take=100&skip=0", { token });
const gameRow = (libraryRows.body ?? []).find((g) => g.objectId === objectId);
check("game has a remote id to sync achievements against", () =>
  assert.ok(gameRow?.id, JSON.stringify(libraryRows.body).slice(0, 200))
);

const unlockedAt = Math.floor(Date.now() / 1000);
const souvenirPayload = {
  clientId: "souvenir-1",
  imageKey: presign.body.imageKey,
  capturedAt: unlockedAt,
  achievementNames: ["ACH_FIRST_BLOOD"],
};
const syncAchievements = await req("PUT", "/profile/games/achievements", {
  token,
  body: {
    id: gameRow.id,
    achievements: [
      { name: "ACH_FIRST_BLOOD", unlockTime: unlockedAt },
      { name: "ACH_SECOND", unlockTime: unlockedAt },
    ],
    souvenirs: [souvenirPayload],
  },
});
check("achievements sync carrying souvenirs succeeds", () =>
  assert.equal(syncAchievements.status, 200)
);

const achievementsPath = `/users/${myUserId}/games/achievements?shop=${shop}&objectId=${objectId}&language=en`;
const readBack = await req("GET", achievementsPath, { token });
check("GET /users/:id/games/achievements is implemented", () =>
  assert.ok(Array.isArray(readBack.body), `status ${readBack.status}`)
);
const souvenired = (readBack.body ?? []).find((a) => a.name === "ACH_FIRST_BLOOD");
const plain = (readBack.body ?? []).find((a) => a.name === "ACH_SECOND");
check("the souvenired achievement carries an imageUrl", () =>
  assert.ok(souvenired?.imageUrl, JSON.stringify(souvenired))
);
check("that imageUrl points at the uploaded image", () =>
  assert.ok(souvenired.imageUrl.includes(presign.body.imageKey))
);
check("an achievement without a souvenir has no imageUrl", () =>
  assert.equal(plain?.imageUrl ?? null, null)
);

// Retrying the same clientId must not duplicate anything.
await req("PUT", "/profile/games/achievements", {
  token,
  body: {
    id: gameRow.id,
    achievements: [{ name: "ACH_FIRST_BLOOD", unlockTime: unlockedAt }],
    souvenirs: [souvenirPayload],
  },
});
const afterRetry = await req("GET", achievementsPath, { token });
check("re-sending the same souvenir clientId is idempotent", () =>
  assert.equal(
    (afterRetry.body ?? []).filter((a) => a.name === "ACH_FIRST_BLOOD").length,
    1
  )
);

const foreign = await req(
  "GET",
  `/users/someone-else/games/achievements?shop=${shop}&objectId=${objectId}`,
  { token }
);
check("another user's achievements are not exposed here", () =>
  assert.equal(foreign.status, 403)
);

const badExt = await req("POST", "/presigned-urls/achievement-image", {
  token,
  body: { imageExt: "exe", imageLength: 10 },
});
check("a non-image extension is rejected (400)", () =>
  assert.equal(badExt.status, 400)
);

const tooBig = await req("POST", "/presigned-urls/achievement-image", {
  token,
  body: { imageExt: "jpg", imageLength: 999 * 1024 * 1024 },
});
check("an oversized souvenir is rejected (413)", () =>
  assert.equal(tooBig.status, 413)
);

const badKey = await req("GET", "/achievement-images/..%2F..%2Fhydra.db");
check("a traversal-style image key is refused", () =>
  assert.ok(badKey.status === 400 || badKey.status === 404, `got ${badKey.status}`)
);

log("\n=== friends & friend requests ===");
const friendName = `itest_friend_${Date.now()}`;
const friendReg = await req("POST", "/auth/register", {
  body: { username: friendName, password: "itest-password-123" },
  headers: { Authorization: `Bearer ${INSTANCE_TOKEN}` },
});
const friendToken = friendReg.body?.accessToken ?? friendReg.body?.token;
const friendMe = await req("GET", "/profile/me", { token: friendToken });
const friendId = friendMe.body?.id;
check("a second account exists to exchange requests with", () =>
  assert.ok(friendToken && friendId)
);

const search = await req(
  "GET",
  `/profile/friends/search?query=${encodeURIComponent(friendName)}&take=24&skip=0`,
  { token }
);
check("GET /profile/friends/search is implemented", () =>
  assert.ok(
    Array.isArray(search.body?.friends),
    `status ${search.status} ${JSON.stringify(search.body).slice(0, 140)}`
  )
);
check("search finds the other user", () =>
  assert.equal(search.body.friends.some((f) => f.id === friendId), true)
);
check("search results carry the UserFriend shape", () => {
  const hit = search.body.friends.find((f) => f.id === friendId);
  for (const key of ["id", "displayName", "profileImageUrl", "currentGame"]) {
    assert.ok(key in hit, `missing ${key}`);
  }
});
check("search excludes yourself", () =>
  assert.equal(search.body.friends.some((f) => f.id === myUserId), false)
);

const send = await req("POST", "/profile/friend-requests", {
  token,
  body: { friendCode: friendId },
});
check("POST /profile/friend-requests sends a request", () =>
  assert.equal(send.status, 200, JSON.stringify(send.body))
);

const mySent = await req("GET", "/profile/friend-requests", { token });
check("sender sees it as SENT, keyed by the other user's id", () => {
  const entry = (mySent.body ?? []).find((r) => r.id === friendId);
  assert.ok(entry, JSON.stringify(mySent.body));
  assert.equal(entry.type, "SENT");
});

const theirReceived = await req("GET", "/profile/friend-requests", {
  token: friendToken,
});
check("recipient sees it as RECEIVED", () => {
  const entry = (theirReceived.body ?? []).find((r) => r.id === myUserId);
  assert.ok(entry, JSON.stringify(theirReceived.body));
  assert.equal(entry.type, "RECEIVED");
});

const wrongWayAccept = await req("PATCH", `/profile/friend-requests/${friendId}`, {
  token,
  body: { requestState: "ACCEPTED" },
});
check("the sender cannot accept their own request", () =>
  assert.equal(wrongWayAccept.status, 403)
);

const accept = await req("PATCH", `/profile/friend-requests/${myUserId}`, {
  token: friendToken,
  body: { requestState: "ACCEPTED" },
});
check("PATCH accepts the request", () => assert.equal(accept.status, 200));

const friends = await req("GET", "/profile/friends?take=24&skip=0", { token });
check("GET /profile/friends returns the ProfileFriends shape", () => {
  for (const key of ["totalFriends", "onlineFriends", "friends"]) {
    assert.ok(key in (friends.body ?? {}), `missing ${key}`);
  }
});
check("the accepted friend appears in the list", () =>
  assert.equal(friends.body.friends.some((f) => f.id === friendId), true)
);

const requestsAfterAccept = await req("GET", "/profile/friend-requests", { token });
check("pending requests clear once accepted", () =>
  assert.equal(requestsAfterAccept.body.length, 0)
);

const undo = await req("DELETE", `/profile/friend-requests/${friendId}`, { token });
check("DELETE removes the friendship", () => assert.equal(undo.status, 200));
const afterUndo = await req("GET", "/profile/friends?take=24&skip=0", { token });
check("the friend is gone after removal", () =>
  assert.equal(afterUndo.body.friends.some((f) => f.id === friendId), false)
);

const byUsername = await req("POST", "/profile/friend-requests", {
  token,
  body: { friendCode: friendName },
});
check("a request can also be sent by username", () =>
  assert.equal(byUsername.status, 200, JSON.stringify(byUsername.body))
);
const refuse = await req("PATCH", `/profile/friend-requests/${myUserId}`, {
  token: friendToken,
  body: { requestState: "REFUSED" },
});
check("PATCH refuses a request", () => assert.equal(refuse.status, 200));
const afterRefuse = await req("GET", "/profile/friend-requests", { token });
check("a refused request disappears", () =>
  assert.equal(afterRefuse.body.length, 0)
);

const self = await req("POST", "/profile/friend-requests", {
  token,
  body: { friendCode: myUserId },
});
check("you cannot befriend yourself", () => assert.equal(self.status, 400));

const unknown = await req("POST", "/profile/friend-requests", {
  token,
  body: { friendCode: "nobody-with-this-name" },
});
check("an unknown friend code returns user/not-found", () =>
  assert.equal(unknown.body?.message, "user/not-found")
);

log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
