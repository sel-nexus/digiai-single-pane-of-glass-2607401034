/** Present quality and environment measures without deriving readiness. */
import { ReadinessMetrics } from './DevSecOpsMetrics';

/** Show the five named supplied quality and environment measures. */
export default function QeEnvironmentMetrics() {
  return <ReadinessMetrics family="qe" title="QE and environment metrics" />;
}
