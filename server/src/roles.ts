import type { NextFunction, Request, Response } from 'express';

// AB#comp-roles, criterion 2: until EP-04 (SSO) the acting role comes from the X-Portal-Role header.
// A missing or unknown value is treated as hr_coordinator.
export type PortalRole = 'hr_coordinator' | 'hr_manager';

const ROLE_HEADER = 'X-Portal-Role';

export function attachRole(req: Request, res: Response, next: NextFunction): void {
  res.locals.role = req.get(ROLE_HEADER) === 'hr_manager' ? 'hr_manager' : 'hr_coordinator';
  next();
}

export function roleOf(res: Response): PortalRole {
  return res.locals.role === 'hr_manager' ? 'hr_manager' : 'hr_coordinator';
}

// AB#comp-access, criterion 6: only hr_manager may set compensation. Runs before the body is read.
export function requireHrManager(_req: Request, res: Response, next: NextFunction): void {
  if (roleOf(res) !== 'hr_manager') {
    res.status(403).json({ error: 'Only HR managers can change compensation.' });
    return;
  }
  next();
}
