import type { NextFunction, Request, Response } from 'express';

export type PortalRole = 'hr_coordinator' | 'hr_manager';

// AB#new-hire-compensation, criterion 2: until SSO (EP-04) the acting role comes from
// the X-Portal-Role header. A missing or unknown value is treated as hr_coordinator.
export function readRole(req: Request): PortalRole {
  return req.get('X-Portal-Role') === 'hr_manager' ? 'hr_manager' : 'hr_coordinator';
}

// AB#new-hire-compensation, criterion 6: only hr_manager may write compensation.
export function requireHrManager(req: Request, res: Response, next: NextFunction): void {
  if (readRole(req) !== 'hr_manager') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
