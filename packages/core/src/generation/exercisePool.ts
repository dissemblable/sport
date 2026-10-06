import {
  DIRECT_WORK_CONTRIBUTION,
  type EquipmentCode,
  type ExerciseDefinition,
  type ExperienceLevel,
} from '@sport/shared';
import type { EquipmentInventory, MuscleConfigMap } from '../types';

/**
 * Constitution du vivier d'exercices utilisables pour une séance.
 *
 * Ce filtrage est absolu : tout ce qui passe ici est réalisable par
 * l'utilisateur, ici et maintenant. Un exercice écarté à ce stade ne peut plus
 * réapparaître en aval, quelle que soit sa pertinence — proposer un
 * développé haltères à quelqu'un qui n'a pas d'haltères ruine la confiance
 * dans l'application bien plus qu'une séance sous-optimale.
 */

/** Difficulté maximale tolérée selon le niveau, pour rester exécutable proprement. */
const MAX_DIFFICULTY_BY_LEVEL: Record<ExperienceLevel, number> = {
  beginner: 3,
  intermediate: 4,
  advanced: 5,
};

export interface PoolFilterInput {
  exercises: ExerciseDefinition[];
  inventory: EquipmentInventory;
  experienceLevel: ExperienceLevel;
  muscleConfigs: MuscleConfigMap;
  bannedExerciseIds?: Set<number>;
}

/** L'utilisateur possède-t-il tout le matériel requis par cet exercice ? */
export function canPerform(exercise: ExerciseDefinition, owned: Set<EquipmentCode>): boolean {
  return exercise.equipment.every((code) => owned.has(code));
}

/**
 * Filtre le catalogue selon le matériel, le niveau et les contre-indications.
 */
export function buildExercisePool(input: PoolFilterInput): ExerciseDefinition[] {
  const { exercises, inventory, experienceLevel, muscleConfigs, bannedExerciseIds } = input;

  // Le poids du corps est toujours disponible : c'est le socle de
  // l'entraînement à domicile, jamais quelque chose que l'on « possède ».
  const owned = new Set<EquipmentCode>([...inventory.owned, 'bodyweight']);
  const maxDifficulty = MAX_DIFFICULTY_BY_LEVEL[experienceLevel];

  // Un muscle exclu (blessure) écarte tout exercice qui le sollicite en moteur
  // principal — mais pas ceux où il n'est que stabilisateur, sans quoi une
  // épaule douloureuse interdirait la quasi-totalité du catalogue.
  const excludedAsPrimary = new Set(
    Object.values(muscleConfigs)
      .filter((c) => c.isExcluded)
      .map((c) => c.definition.code),
  );

  return exercises.filter((exercise) => {
    if (bannedExerciseIds?.has(exercise.id)) return false;
    if (!canPerform(exercise, owned)) return false;
    if (exercise.difficulty > maxDifficulty) return false;

    if (excludedAsPrimary.size > 0) {
      const touchesExcluded = exercise.muscles.some(
        (m) => m.role === 'primary' && excludedAsPrimary.has(m.muscle),
      );
      if (touchesExcluded) return false;
    }

    // Un exercice lesté n'a de sens que si l'utilisateur peut réellement ajouter
    // du poids à la barre de traction.
    if (
      exercise.equipment.includes('pull_up_bar') &&
      exercise.equipment.includes('dumbbells') &&
      inventory.pullUpBarCanAddWeight === false
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Seuil de travail direct, partagé avec le calcul de fatigue.
 *
 * La symétrie est essentielle : un exercice ne peut solliciter directement un
 * muscle que si ce même critère l'a préalablement déclaré disponible. Deux
 * seuils différents ouvriraient une faille dans la garantie de repos.
 */
export const SIGNIFICANT_CONTRIBUTION = DIRECT_WORK_CONTRIBUTION;

/**
 * Vérifie qu'un exercice ne charge significativement aucun muscle bloqué.
 *
 * C'est le second verrou de la garantie de repos. Il rejette un mouvement dès
 * qu'un muscle non récupéré y est moteur principal **ou** secondaire lourd :
 * proposer des tractions supination (biceps à 0,7) à quelqu'un dont les biceps
 * n'ont pas récupéré reviendrait à contourner la règle par la bande.
 *
 * Les stabilisateurs et les secondaires légers restent tolérés — leur part de
 * stimulus est marginale, et les éviter tous rendrait la quasi-totalité des
 * séances impossibles à construire (les biceps participent à chaque tirage,
 * les lombaires à chaque charnière de hanche).
 */
export function respectsBlockedMuscles(
  exercise: ExerciseDefinition,
  blocked: Set<string>,
): boolean {
  return !exercise.muscles.some(
    (m) =>
      blocked.has(m.muscle) &&
      (m.role === 'primary' || m.contribution >= SIGNIFICANT_CONTRIBUTION),
  );
}
