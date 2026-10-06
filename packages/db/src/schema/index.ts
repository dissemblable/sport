/**
 * Schéma complet de la base.
 *
 * Organisation par domaine :
 *  - `enums`    types énumérés PostgreSQL, dérivés de @sport/shared
 *  - `catalog`  référentiel immuable : muscles, matériel, exercices
 *  - `users`    profil, matériel possédé, réglages et contre-indications
 *  - `training` mésocycles, plans versionnés, séances planifiées et réalisées
 *  - `fatigue`  journal de fatigue et cache de récupération — le cœur du système
 */

export * from './enums';
export * from './catalog';
export * from './users';
export * from './training';
export * from './fatigue';
