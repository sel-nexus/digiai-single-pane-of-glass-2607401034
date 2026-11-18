/** Preserve supplied scenario destinations while clearly disclosing later modules. */
import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';

/** Navigate through real links to the current unavailable-module route. */
export function ScenarioLauncher({ scenarios }) {
  const location = useLocation();
  return (
    <section className="section-stack" aria-labelledby="scenarios-title">
      <p className="eyebrow">Explicit sample contexts</p>
      <h2 id="scenarios-title">Explore a scenario</h2>
      {!scenarios.length && <p role="status">No scenarios configured.</p>}
      <div className="scenario-list">
        {scenarios.map((scenario) => (
          <article key={scenario.id}>
            <h3>{scenario.label}</h3>
            <p className="muted">{scenario.description}</p>
            <Link to={`${scenario.destination}${location.search}`}>View scenario context · Module unavailable →</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
ScenarioLauncher.propTypes = { scenarios: PropTypes.array.isRequired };
