export type ArmyListWeapon = { weaponId: number; name: string; count: number };

export type ArmyListUnit = {
  id: string;
  unitId: string;
  name: string;
  modelCount: number;
  weapons: ArmyListWeapon[];
};

export type ArmyListInput = {
  name: string;
  factionId: string;
  units: ArmyListUnit[];
};

export type ArmyListRecord = ArmyListInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export async function fetchArmyLists() {
  const response = await fetch("/api/v1/lists");
  if (!response.ok) throw new Error("Saved lists are unavailable");
  return ((await response.json()) as { data: ArmyListRecord[] }).data;
}
