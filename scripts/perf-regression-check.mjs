import { execFileSync } from 'node:child_process';

function runCli(args) {
  return execFileSync('playwright-cli', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJsonFromCliResult(stdout) {
  const match = stdout.match(/### Result\s*\n([\s\S]*?)(?:\n### |\s*$)/);
  if (!match) {
    throw new Error(`Could not find Result block in playwright-cli output:\n${stdout}`);
  }
  const raw = match[1].trim();
  const parsed = JSON.parse(raw);
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}

const TARGET_URL = process.env.STADIUMX_URL || 'http://localhost:3000/?autostart=1&profile=1';

try {
  runCli(['open', '--browser=chromium', TARGET_URL]);
  runCli(['resize', '1280', '800']);

  const runOut = runCli([
    'run-code',
    `async (page) => {
      await page.waitForFunction(
        () => Boolean(
          window.__STADIUMX_BLENDER_STATUS__?.loaded &&
          window.__STADIUMX_PERF_HOOKS__ &&
          window.__STADIUMX_PROFILE__ &&
          window.__STADIUMX_PERF__?.visibleSeatBlockCount > 0
        ),
        null,
        { timeout: 60000 }
      );
      await page.waitForTimeout(800);

      // 1. Switch to HIGH preset in aerial view and settle
      await page.evaluate(() => {
        window.__STADIUMX_PERF_HOOKS__.setQualityPreset('HIGH');
        window.__STADIUMX_PERF_HOOKS__.setCameraView([0, 56, 86], [0, 4, -8]);
      });
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__STADIUMX_PROFILE__.startRecording());

      // 2. Orbit continuously for 10 seconds
      const start = Date.now();
      let step = 0;
      while (Date.now() - start < 10000) {
        const cx = 640 + Math.cos(step * 0.5) * 90;
        const cy = 400 + Math.sin(step * 0.5) * 35;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + (step % 2 === 0 ? 140 : -140), cy + 25, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(180);
        step++;
      }

      const orbitReport = await page.evaluate(() => window.__STADIUMX_PROFILE__.stopRecording());
      const orbitPerf = await page.evaluate(() => window.__STADIUMX_PERF__);

      // 3. Far >150m ROW_STRIP check (full aerial zoom-out where all chunks > 150m surface distance)
      await page.evaluate(() => {
        window.__STADIUMX_PERF_HOOKS__.setCameraView([0, 145, 290], [0, 0, 0]);
      });
      await page.waitForFunction(
        () => (window.__STADIUMX_PERF__?.cameraPos?.[2] ?? 0) > 250 && (window.__STADIUMX_PERF__?.lodCounts?.ROW_STRIP ?? 0) > 0,
        null,
        { timeout: 15000 }
      );
      await page.waitForTimeout(400);
      const farPerf = await page.evaluate(() => window.__STADIUMX_PERF__);

      return JSON.stringify({
        isSoftwareGl: Boolean(orbitPerf?.isSoftwareGl),
        orbit: {
          drawCalls: orbitReport?.avgDrawCalls ?? orbitPerf?.drawCalls,
          maxDrawCalls: orbitReport?.maxDrawCalls,
          triangles: orbitReport?.avgTriangles ?? orbitPerf?.triangles,
          p99FrameMs: orbitReport?.p99FrameMs,
          avgFrameMs: orbitReport?.avgFrameMs,
          avgJsMs: orbitReport?.avgJsMs,
          avgGpuMs: orbitReport?.avgGpuMs,
          avgFps: orbitReport?.avgFps,
          reactRendersPerSec: orbitReport?.reactRendersPerSec ?? 0,
          longTaskCount: orbitReport?.longTaskCount ?? 0,
          lodCounts: orbitPerf?.lodCounts,
        },
        far320m: {
          drawCalls: farPerf?.drawCalls,
          triangles: farPerf?.triangles,
          rowStripCount: farPerf?.lodCounts?.ROW_STRIP ?? 0,
        },
      });
    }`,
  ]);

  const data = parseJsonFromCliResult(runOut);
  const consoleErrs = runCli(['console', 'error']);
  if (!consoleErrs.includes('Errors: 0')) {
    throw new Error(`Console errors detected:\n${consoleErrs}`);
  }

  console.log('STADIUMX Automated Perf Regression Result:', JSON.stringify(data, null, 2));

  const failures = [];
  if (data.orbit.reactRendersPerSec > 0) {
    failures.push(`Expected 0 React renders/sec during orbit, got ${data.orbit.reactRendersPerSec}`);
  }
  if (data.orbit.drawCalls > 85) {
    failures.push(`Expected <= 85 draw calls on HIGH orbit, got ${data.orbit.drawCalls}`);
  }
  if (data.orbit.triangles > 2600000) {
    failures.push(`Expected <= 2.6M triangles in HIGH aerial orbit, got ${data.orbit.triangles}`);
  }
  if (data.far320m.rowStripCount < 20) {
    failures.push(`Expected ROW_STRIP fallback beyond 150m (>= 20 chunks), got ${data.far320m.rowStripCount}`);
  }
  if (data.far320m.triangles > 500000) {
    failures.push(`Expected <= 500k triangles at 320m far zoom-out, got ${data.far320m.triangles}`);
  }

  if (!data.isSoftwareGl) {
    if (data.orbit.p99FrameMs >= 20) {
      failures.push(`Hardware GPU p99 frame time ${data.orbit.p99FrameMs} ms exceeded < 20 ms budget`);
    }
  } else {
    console.log(
      `[INFO] Running under SwiftShader software WebGL (CPU rasterizer). Deterministic architecture gates passed; hardware GPU p99 < 20 ms gate requires a hardware GPU environment.`
    );
  }

  if (failures.length > 0) {
    throw new Error(`Performance regression check failed:\n- ${failures.join('\n- ')}`);
  }
  console.log('PASS: All STADIUMX automated 3D performance regression checks passed.');
} finally {
  try {
    runCli(['close']);
  } catch {}
}
