import { closeDatabase, getDatabase, users } from '@sport/db';
import { buildAthleteContext, persistFatigueCache } from '../services/recovery';

/**
 * Régénère le cache d'état de récupération à partir du journal de fatigue.
 *
 * Cette commande démontre — et garantit — la propriété centrale du modèle :
 * `muscle_fatigue_states` ne contient aucune information qui ne soit
 * reconstructible depuis `muscle_fatigue_events`. Le cache peut être perdu,
 * corrompu ou vidé sans aucune perte de données.
 *
 * Tous les profils sont traités : le profil local comme ceux des comptes SSO.
 */
async function main() {
  const db = getDatabase();

  try {
    const profiles = await db
      .select({ id: users.id, displayName: users.displayName, externalId: users.externalId })
      .from(users);

    if (profiles.length === 0) {
      console.error('Aucun utilisateur en base. Lancez `pnpm db:seed`.');
      process.exit(1);
    }

    const now = new Date();

    for (const profile of profiles) {
      const context = await buildAthleteContext(db, profile.id, now);
      await persistFatigueCache(db, profile.id, context.snapshot);

      const states = Object.values(context.snapshot.byMuscle);
      const blocked = states.filter((state) => !state.isAvailable);

      console.log(
        `${profile.externalId ?? 'profil local'} (${profile.displayName}) — ` +
          `cache reconstruit à partir de ${context.events.length} événements : ` +
          `${states.length} muscles, dont ${blocked.length} indisponibles.`,
      );

      for (const state of blocked) {
        const hours = state.hoursUntilAvailable;
        console.log(
          `  ${state.muscle.padEnd(14)} ${state.status.padEnd(12)} ` +
            (hours === null ? 'exclu' : `disponible dans ${Math.round(hours)} h`),
        );
      }
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error('Échec de la reconstruction :', error);
  process.exit(1);
});
