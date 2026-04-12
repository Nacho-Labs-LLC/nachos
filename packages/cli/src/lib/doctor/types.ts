/**
 * Types for doctor command
 */

export interface DoctorCheck {
  /** Unique check identifier */
  id: string;
  /** Human-readable check name */
  name: string;
  /** Check status */
  status: 'pass' | 'warn' | 'fail';
  /** Check result message */
  message: string;
  /** Optional suggestion for failed/warned checks */
  suggestion?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
}
