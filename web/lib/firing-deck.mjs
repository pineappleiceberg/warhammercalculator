function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000) {
    throw new Error(`${label} must be an integer from 1 to 1000`);
  }
  return value;
}

function itemById(items, id, label) {
  const value = String(id);
  const item = items.find((entry) => String(entry.id) === value);
  if (!item) throw new Error(`${label} was not found: ${value}`);
  return item;
}

export function isOneShotWeapon(weapon) {
  return weapon.abilities.some((ability) => ability.name.toLowerCase() === "one shot");
}

export function firingDeckWeapons(unit) {
  return unit.weapons.filter((weapon) => weapon.type === "Ranged" && !isOneShotWeapon(weapon));
}

export function resolveFiringDeckSelection(catalogue, transport, candidate) {
  if (!transport?.firingDeck)
    throw new Error(`${transport?.name ?? "Attacker"} has no Firing Deck`);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Each Firing Deck selection must be an object");
  }
  const passenger = itemById(catalogue.units, candidate.passengerUnitId, "Passenger unit");
  if (passenger.id === transport.id) throw new Error("A transport cannot be its own passenger");
  const transportEligibility = transportPassengerEligibility(transport, passenger);
  if (!transportEligibility.eligible) throw new Error(transportEligibility.reason);
  const weapon = itemById(passenger.weapons, candidate.weaponId, "Passenger weapon");
  if (weapon.type !== "Ranged") throw new Error("Firing Deck can select only ranged weapons");
  if (isOneShotWeapon(weapon)) throw new Error("Firing Deck cannot select a One Shot weapon");
  if (candidate.unitAlreadyShot === true) {
    throw new Error(
      "Firing Deck cannot select models from a unit that has already shot this phase",
    );
  }
  if (candidate.unitAlreadyShot !== undefined && candidate.unitAlreadyShot !== false) {
    throw new Error("unitAlreadyShot must be true or false");
  }
  const modelCount = positiveInteger(candidate.modelCount, "Selected passenger models");
  const modelCost = positiveInteger(passenger.firingDeckModelCost ?? 1, "Firing Deck model cost");
  const slots = modelCount * modelCost;
  if (slots > transport.firingDeck.capacity) {
    throw new Error(
      `Firing Deck selection uses ${slots} model slots; ${transport.name} allows ${transport.firingDeck.capacity}`,
    );
  }
  return {
    passengerUnitId: passenger.id,
    passengerUnitName: passenger.name,
    weaponId: weapon.id,
    weaponName: weapon.name,
    modelCount,
    modelCost,
    slots,
    unitAlreadyShot: false,
    passenger,
    weapon,
  };
}

export function resolveFiringDeckSelections(catalogue, transport, candidates) {
  if (!Array.isArray(candidates) || candidates.length > 100) {
    throw new Error("Firing Deck selections must contain at most 100 entries");
  }
  const resolved = candidates.map((candidate) =>
    resolveFiringDeckSelection(catalogue, transport, candidate),
  );
  const slots = resolved.reduce((total, selection) => total + selection.slots, 0);
  if (slots > (transport.firingDeck?.capacity ?? 0)) {
    throw new Error(
      `Firing Deck selections use ${slots} model slots; ${transport.name} allows ${transport.firingDeck.capacity}`,
    );
  }
  return { capacity: transport.firingDeck?.capacity ?? 0, slots, selections: resolved };
}

export function firingDeckWeaponLines(catalogue, transport, candidates) {
  return resolveFiringDeckSelections(catalogue, transport, candidates).selections.map(
    (selection) => ({
      weapon: selection.weapon,
      count: selection.modelCount,
      firingDeck: {
        passengerUnitId: selection.passengerUnitId,
        passengerUnitName: selection.passengerUnitName,
        modelCost: selection.modelCost,
      },
    }),
  );
}
import { transportPassengerEligibility } from "./transport.mjs";
