import type { MouseEvent, ReactNode } from 'react';

// Path of the current page without a trailing slash ("/" for the home page).
export function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

// Changes the address bar without a reload and tells the App to re-render.
export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('locationchange'));
}

interface LinkProps {
  to: string;
  children: ReactNode;
}

// A real <a href> so keyboard, middle-click and screen readers behave as links do.
export function Link({ to, children }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigateTo(to);
  }

  return (
    <a href={to} onClick={handleClick}>
      {children}
    </a>
  );
}
