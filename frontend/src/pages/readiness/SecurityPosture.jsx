/** Present source security indicators without certification claims. */
import { ReadinessMetrics } from './DevSecOpsMetrics';

/** Show the four named supplied security and risk measures. */
export default function SecurityPosture() {
  return <ReadinessMetrics family="security" title="Security posture indicators" />;
}
