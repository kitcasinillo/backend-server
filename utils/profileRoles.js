const { collection, getDocs, limit, query, where } = require('firebase/firestore');

const getProfileRoles = (data = {}) => {
  const raw = Array.isArray(data.roles)
    ? [...data.roles, data.role, data.type]
    : [data.role, data.type];
  return Array.from(
    new Set(
      raw
        .filter(Boolean)
        .map((r) => String(r).toLowerCase().trim())
        .filter(Boolean)
    )
  );
};

const hasRole = (data = {}, targetRole) => {
  const normalized = String(targetRole || '').toLowerCase().trim();
  if (!normalized) return false;
  return getProfileRoles(data).includes(normalized);
};

const queryProfilesByRole = async (db, targetRole, maxLimit = 250) => {
  const normalized = String(targetRole || '').toLowerCase().trim();
  const profilesRef = collection(db, 'profiles');
  const [byRolesSnap, byLegacyRoleSnap] = await Promise.all([
    getDocs(query(profilesRef, where('roles', 'array-contains', normalized), limit(maxLimit))),
    getDocs(query(profilesRef, where('role', '==', normalized), limit(maxLimit))),
  ]);

  const merged = new Map();
  for (const docSnap of byRolesSnap.docs) {
    merged.set(docSnap.id, docSnap);
  }
  for (const docSnap of byLegacyRoleSnap.docs) {
    if (!merged.has(docSnap.id)) {
      merged.set(docSnap.id, docSnap);
    }
  }
  return Array.from(merged.values());
};

module.exports = {
  getProfileRoles,
  hasRole,
  queryProfilesByRole,
};
