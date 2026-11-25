import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'voice-sales-agent-token';

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  save(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session.token && { Authorization: `Bearer ${session.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/login') {
    session.clear();
    window.location.assign('/login');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null });
  const reload = useCallback(() => load().then(
    (data) => setState({ data, error: null }),
    (error) => setState((prev) => ({ ...prev, error })),
  ), deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}
