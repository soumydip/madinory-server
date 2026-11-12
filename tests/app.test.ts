import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";

const app = createApp(loadConfig({
  NODE_ENV: "test",
  FRONTEND_ORIGINS: "http://localhost:3000"
}));

describe("API foundation", () => {
  it("allows the health endpoint without authentication", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: "ok" } });
  });

  it("rejects protected requests without a session cookie", async () => {
    const response = await request(app).get("/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("returns the standard validation error shape", async () => {
    const response = await request(app)
      .post("/test/validate")
      .set("Origin", "http://localhost:3000")
      .set("X-CSRF-Token", "test")
      .set("Cookie", "medinory_csrf=test")
      .send({ unexpected: true });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.fields[0].field).toBe("name");
  });

  it("rate limits requests after the configured threshold", async () => {
    const limitedApp = createApp(loadConfig({
      NODE_ENV: "test",
      FRONTEND_ORIGINS: "http://localhost:3000"
    }));

    const responses = await Promise.all(
      Array.from({ length: 101 }, () => request(limitedApp).get("/health"))
    );
    expect(responses.at(-1)?.status).toBe(429);
  });

  it("rejects invalid password registration payloads and unknown fields", async () => {
    const response = await request(app)
      .post("/auth/register")
      .send({ email: "not-an-email", password: "short", role: "admin" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.fields.map((field: { field: string }) => field.field)).toEqual(
      expect.arrayContaining(["email", "password", "role"])
    );
  });

  it("rejects invalid password login payloads", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "patient@example.com", password: "short" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("clears session cookies on logout", async () => {
    const response = await request(app)
      .post("/auth/logout")
      .set("Cookie", "medinory_access=access; medinory_refresh=refresh; medinory_csrf=test")
      .set("Origin", "http://localhost:3000")
      .set("X-CSRF-Token", "test");

    expect(response.status).toBe(200);
    expect(String(response.headers["set-cookie"])).toContain("medinory_access=;");
    expect(String(response.headers["set-cookie"])).toContain("medinory_refresh=;");
  });

  it("blocks OAuth open redirects and preserves a safe relative path", async () => {
    const response = await request(app)
      .get("/auth/google?next=https%3A%2F%2Fevil.example")
      .redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:3000/login?error=oauth_failed");
    expect(String(response.headers["set-cookie"])).toContain("medinory_oauth=");
  });

  it("rejects OAuth callbacks with missing code or mismatched state", async () => {
    const missingCode = await request(app)
      .get("/auth/google/callback?state=not-the-cookie")
      .redirects(0);

    expect(missingCode.status).toBe(302);
    expect(missingCode.headers.location).toBe("http://localhost:3000/login?error=oauth_failed");
  });

  it("rejects profile updates without authentication", async () => {
    const response = await request(app)
      .patch("/me")
      .set("Origin", "http://localhost:3000")
      .set("X-CSRF-Token", "test")
      .set("Cookie", "medinory_csrf=test")
      .send({ full_name: "Patient", role: "admin" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("rejects hospital registration applications without authentication", async () => {
    const response = await request(app)
      .post("/auth/register/hospital")
      .set("Origin", "http://localhost:3000")
      .set("X-CSRF-Token", "test")
      .set("Cookie", "medinory_csrf=test")
      .send({
        hospital_name: "Example Hospital",
        phone_e164: "+919876543210",
        address: "1 Health Street",
        city: "Pune",
        state: "Maharashtra",
        country_code: "IN",
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("rejects admin actions without authentication", async () => {
    const response = await request(app)
      .post("/admin/users/not-a-uuid/role")
      .send({ role: "doctor" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("rejects MFA endpoints without authentication", async () => {
    const response = await request(app).post("/auth/mfa/enroll");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

});
