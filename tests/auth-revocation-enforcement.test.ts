import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createFirebaseVerifier } from "../src/server/database.ts";

test("server token verification enforces checkRevoked=true against Firebase Admin", async (t) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || "focus-clean-4b9f4";
  process.env.FIREBASE_PROJECT_ID = projectId;
  if (!getApps().length) {
    initializeApp({ projectId });
  }

  const verifier = await createFirebaseVerifier();

  // 1. Rejects missing / non-string tokens
  await assert.rejects(async () => {
    await verifier.verify("");
  }, /Unauthorized/);

  await assert.rejects(async () => {
    await verifier.verify("not-a-valid-token-string");
  }, /Unauthorized/);

  // 2. Rejects tokens exceeding length limit
  await assert.rejects(async () => {
    await verifier.verify("a".repeat(10001));
  }, /Unauthorized/);

  // 3. Verify that mock revoked token triggers fail-closed Unauthorized
  const authInstance = getAuth();
  const origVerifyIdToken = authInstance.verifyIdToken.bind(authInstance);

  // Verify that verifier actually calls verifyIdToken with checkRevoked === true
  let passedCheckRevoked: boolean | undefined;
  authInstance.verifyIdToken = async (token: string, checkRevoked?: boolean) => {
    passedCheckRevoked = checkRevoked;
    if (token === "mock-revoked-token") {
      const err: any = new Error("Firebase ID token has been revoked.");
      err.code = "auth/id-token-revoked";
      throw err;
    }
    return {
      uid: "test-user-uid",
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: "password" }
    } as any;
  };

  try {
    // Valid token check
    const uid = await verifier.verify("valid-mock-token");
    assert.equal(uid, "test-user-uid");
    assert.equal(passedCheckRevoked, true, "verifyIdToken MUST be called with checkRevoked === true");

    // Revoked token check
    await assert.rejects(async () => {
      await verifier.verify("mock-revoked-token");
    }, /Unauthorized/, "Revoked token must fail closed with Unauthorized error");
  } finally {
    authInstance.verifyIdToken = origVerifyIdToken;
  }
});
