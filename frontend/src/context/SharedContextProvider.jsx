/** Share session display context and preserve repeated URL filter values. */
import { createContext, useContext, useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { serializeContext } from '../services/apiClient';

const SharedContext = createContext(null);
const dimensions = ['domain', 'portfolio', 'application', 'environment', 'criticality', 'dateRange', 'toolSource', 'incidentSeverity'];

/** Parse navigable view scope while deliberately ignoring URL persona selection. */
function parseScope(search) {
  const query = new URLSearchParams(search);
  return { filters: Object.fromEntries(dimensions.filter((key) => query.has(key)).map((key) => [key, query.getAll(key)])), hierarchyNodeId: query.get('hierarchyNodeId') };
}

/** Reduce only explicitly supplied persona and scope actions. */
export function contextReducer(state, action) {
  if (action.type === 'persona') return { ...state, personaId: action.id };
  if (action.type === 'scope') return { ...state, ...action.scope };
  return state;
}

/** Provide transient persona state; URL scope is a foundation, not discovery UI. */
export function SharedContextProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [context, dispatch] = useReducer(contextReducer, { personaId: null, ...parseScope(location.search) });
  useEffect(() => dispatch({ type: 'scope', scope: parseScope(location.search) }), [location.search]);
  const setScope = (scope) => {
    dispatch({ type: 'scope', scope });
    navigate({ pathname: location.pathname, search: serializeContext(scope) });
  };
  return (
    <SharedContext.Provider value={{ context, setPersona: (id) => dispatch({ type: 'persona', id }), setScope }}>
      {children}
    </SharedContext.Provider>
  );
}
SharedContextProvider.propTypes = { children: PropTypes.node.isRequired };

/** Require the shared provider rather than silently creating isolated state. */
export function useSharedContext() {
  const value = useContext(SharedContext);
  if (!value) throw new Error('SharedContextProvider is required');
  return value;
}
