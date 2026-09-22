import vm from 'node:vm';
import { injection as widget } from './context/index.mjs';
import { injection as localization } from './localization/index.mjs';

export const injections = [widget, localization];
// Syntax failures are permanent for this loaded version, but stay isolated to
// their plugin (including optional translations).
for (const injection of injections) {
  try { new vm.Script(injection.install); }
  catch (error) { injection.validationError = error.message; }
}

export function hasRequiredFailure(result) {
  return injections.some(({ key, required }) => required && !result[key]?.installed);
}

export function runFailed(results, mode) {
  return !results.some(result => ['supported', 'removed'].includes(result.status)) ||
    results.some(result => result.status === 'error' ||
      (mode === 'install' && result.status === 'supported' && hasRequiredFailure(result)));
}

// Transport retries belong to the target; script failures live in the page so
// navigation resets them automatically, even when the CDP target ID is reused.
export async function runInjections(evaluate, mode, retries = new Map(), now = Date.now()) {
  const results = {};
  for (const injection of injections) {
    const { key, version, probe, install, dispose } = injection;
    const id = JSON.stringify(key);
    const revision = JSON.stringify(version);
    try {
      if (mode === 'remove') {
        await evaluate(`(() => { ${dispose} delete window.__agyInjectionFailures?.[${id}]; return true; })()`);
        retries.delete(key);
        results[key] = { installed: false };
        continue;
      }
      if (injection.validationError) {
        results[key] = { installed: false, message: injection.validationError };
        continue;
      }
      const state = await evaluate(`(() => {
        const state = ${probe};
        const failure = window.__agyInjectionFailures?.[${id}];
        if (!state.installed && failure?.version === ${revision}) state.message = failure.message;
        return state;
      })()`);
      results[key] = state;
      if (state.installed) { retries.delete(key); continue; }
      if (mode !== 'install' || state.message) continue;
      const retry = retries.get(key);
      if (retry && now < retry.nextAttempt) {
        results[key] = { ...state, message: retry.message, retryAfterMs: retry.nextAttempt - now };
        continue;
      }
      // These payloads are synchronous. Once the DOM is ready, an exception
      // from the payload is a script failure, not a network retry signal.
      results[key] = await evaluate(`(() => {
        if (!document.body || document.readyState === 'loading') return {installed:false, waiting:true};
        try {
          (() => { ${install} })();
          delete window.__agyInjectionFailures?.[${id}];
          return ${probe};
        } catch (error) {
          try { ${dispose} } catch {}
          const message = String(error.message || error);
          (window.__agyInjectionFailures ??= Object.create(null))[${id}] = {version:${revision}, message};
          return {installed:false, message};
        }
      })()`);
      retries.delete(key);
    } catch (error) {
      const attempts = (retries.get(key)?.attempts || 0) + 1;
      const retryAfterMs = Math.min(30000, 2500 * 2 ** Math.min(attempts, 4));
      retries.set(key, { attempts, nextAttempt: now + retryAfterMs, message: error.message });
      results[key] = { installed: false, message: error.message, retryAfterMs };
    }
  }
  return results;
}
