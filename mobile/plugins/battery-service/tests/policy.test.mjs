import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const javaHome = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin')
  : process.platform === 'win32' ? 'C:/Program Files/Common Files/Oracle/Java/javapath' : '';
const executable = name => javaHome ? path.join(javaHome, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
const javaHarness = `package com.batteryinventory.service;
import java.util.*;
public class PolicyHarness {
 static int count;
 interface Action { void run() throws Exception; }
 static void check(boolean value, String label) { if (!value) throw new AssertionError(label); count++; }
 static void fails(Action action, String code) throws Exception {
  try { action.run(); throw new AssertionError("Expected " + code); }
  catch (ServicePolicy.Failure error) { check(error.code.equals(code), "failure code " + code); check(!error.getMessage().contains("aaaa"), "no cookie value in errors"); }
 }
 public static void main(String[] args) throws Exception {
  check(ServicePolicy.origin("HTTPS://Inventory.Example:443/").equals("https://inventory.example"), "canonical origin");
  check(ServicePolicy.origin("https://inventory.example:8443").equals("https://inventory.example:8443"), "custom HTTPS port");
  for (String invalid : new String[]{"http://inventory.example", "https://user:pass@inventory.example", "https://inventory.example/api", "https://inventory.example?x=1", "https://inventory.example#x", "https://inventory.example:0", "https://inventory.example:65536", "https://", "file:///tmp/test"}) fails(() -> ServicePolicy.origin(invalid), "INVALID_ORIGIN");
  for (String route : ServicePolicy.ROUTES) check(ServicePolicy.requestUri("https://inventory.example", route + "?dataset=demo&x=%2F").getRawPath().equals(route), "allowed route");
  for (String invalid : new String[]{"https://other.example/api/session", "//other.example/api/session", "/api/inventory/../session", "/api/%73ession", "/api/session#x", "/api/session/", "/api/session\\\\x", "/api/admin", "/api/session?x=\\r\\nOrigin: bad"}) fails(() -> ServicePolicy.requestUri("https://inventory.example", invalid), "INVALID_PATH");
  ServicePolicy.request("/api/inventory", "POST", "{}", Map.of("content-type", "application/json", "accept", "application/json")); count++;
  ServicePolicy.request("/api/export", "POST", "{}", Map.of("Content-Type", "application/json; charset=utf-8")); count++;
  fails(() -> ServicePolicy.request("/api/session", "DELETE", null, Map.of()), "INVALID_METHOD");
  fails(() -> ServicePolicy.request("/api/session", "GET", "{}", Map.of()), "INVALID_BODY");
  fails(() -> ServicePolicy.request("/api/session", "POST", "x".repeat(5001), Map.of()), "REQUEST_TOO_LARGE");
  fails(() -> ServicePolicy.request("/api/export", "POST", "x".repeat(15001), Map.of()), "REQUEST_TOO_LARGE");
  fails(() -> ServicePolicy.request("/api/inventory", "POST", "é".repeat(125001), Map.of()), "REQUEST_TOO_LARGE");
  for (Map<String,String> headers : List.of(Map.of("Cookie", "forged"), Map.of("Origin", "https://evil.example"), Map.of("Authorization", "Bearer forged"), Map.of("accept", "x\\r\\ny"), Map.of("content-type", "text/plain"), Map.of("accept", "a", "Accept", "b"))) fails(() -> ServicePolicy.request("/api/inventory", "POST", "{}", headers), "INVALID_HEADERS");
  long now = 1_700_000_000_000L;
  String token = "a".repeat(64), prefix = "inventory_session=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; ";
  var cookie = ServicePolicy.cookie(List.of(prefix + "Max-Age=28800"), now);
  check(cookie.present && cookie.token.equals(token) && cookie.expiresAt == now + ServicePolicy.SESSION_MILLIS, "secure session accepted");
  check(ServicePolicy.cookie(List.of(prefix + "Max-Age=999999999999"), now).expiresAt == now + ServicePolicy.SESSION_MILLIS, "eight hour bound");
  check(ServicePolicy.cookie(List.of(prefix + "Max-Age=0"), now).token == null, "expired cookie clears");
  check(ServicePolicy.cookie(List.of("inventory_session=; Path=/; HttpOnly; Secure; Max-Age=0"), now).token == null, "signout clears");
  check(ServicePolicy.cookie(List.of("other=value; Path=/"), now).present == false, "unrelated cookie ignored");
  check(ServicePolicy.cookie(List.of(prefix + "Expires=Wed, 15 Nov 2023 01:13:20 GMT"), now).expiresAt == now + 3 * 60 * 60 * 1000, "RFC expiry parsed without truncating comma");
  for (String invalid : new String[]{prefix + "Max-Age=wrong", prefix + "Max-Age=1; Domain=inventory.example", prefix + "Max-Age=1; Max-Age=2", prefix, prefix.replace("HttpOnly; ", "") + "Max-Age=1", prefix.replace("Secure; ", "") + "Max-Age=1", prefix.replace("Path=/", "Path=/api") + "Max-Age=1", prefix.replace(token, "A".repeat(64)) + "Max-Age=1"}) fails(() -> ServicePolicy.cookie(List.of(invalid), now), "SESSION_COOKIE_INVALID");
  fails(() -> ServicePolicy.cookie(List.of(prefix + "Max-Age=1", prefix + "Max-Age=2"), now), "SESSION_COOKIE_INVALID");
  check(ServicePolicy.textContent("application/json; charset=utf-8") && ServicePolicy.textContent("application/problem+json") && ServicePolicy.textContent("text/csv") && !ServicePolicy.textContent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "text/binary distinction");
  System.out.println("Passed " + count + " assertions against production Android transport policy; no Android SDK or device acceptance is implied.");
 }
}`;

test('production Java transport policy rejects origin/route/header/cookie confusion', { timeout: 30000 }, async context => {
  const version = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) return context.skip('JDK unavailable; policy execution not performed.');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const work = await mkdtemp(path.join(root, 'work/policy-'));
  const harness = path.join(work, 'PolicyHarness.java');
  await writeFile(harness, javaHarness);
  const compile = spawnSync(executable('javac'), ['-d', work, path.join(root, 'android/src/main/java/com/batteryinventory/service/ServicePolicy.java'), harness], { encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const run = spawnSync(executable('java'), ['-cp', work, 'com.batteryinventory.service.PolicyHarness'], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  context.diagnostic(run.stdout.trim());
});
