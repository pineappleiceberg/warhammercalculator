import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { antiWoundThreshold } from "../lib/anti.mjs";
import { rulesInteractionCases } from "./rules-interaction-corpus.mjs";

const projectRoot = new URL("../", import.meta.url);

function createD1Mock() {
  const rows = [];
  return {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async run() {
          if (sql.startsWith("INSERT")) {
            const next = {
              id: values[0],
              name: values[1],
              faction_id: values[2],
              roster: values[3],
              created_at: values[4],
              updated_at: values[5],
            };
            const existing = rows.find((entry) => entry.id === values[0]);
            if (existing) Object.assign(existing, next);
            else rows.push(next);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE")) {
            const row = rows.find((entry) => entry.id === values[4]);
            if (!row) return { meta: { changes: 0 } };
            Object.assign(row, {
              name: values[0],
              faction_id: values[1],
              roster: values[2],
              updated_at: values[3],
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE")) {
            const index = rows.findIndex((entry) => entry.id === values[0]);
            if (index < 0) return { meta: { changes: 0 } };
            rows.splice(index, 1);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [...rows].sort((a, b) => b.updated_at - a.updated_at) };
        },
        async first() {
          return rows.find((entry) => entry.id === values[0]) ?? null;
        },
      };
    },
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const testEnv = {
  ARMY_DB: createD1Mock(),
  ASSETS: {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname.replace(/^\//, "");
      try {
        return new Response(await readFile(new URL(`../public/${pathname}`, import.meta.url)));
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};

async function render(pathname = "/") {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    testEnv,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the calculator interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Warhammer Damage Calculator<\/title>/i);
  assert.match(html, /Damage Calculator/);
  assert.match(html, /Expected damage/);
  assert.match(html, /Weapon rules/);
  assert.match(html, /Sustained Hits/);
  assert.match(html, /Rapid Fire/);
  assert.match(html, /Hit re-rolls/);
  assert.match(html, /Wound re-rolls/);
  assert.match(html, /Other Hit modifier/);
  assert.match(html, /Other Wound modifier/);
  assert.match(html, /Roll this attack/);
  assert.match(html, /Share matchup/);
  assert.match(html, /aria-label="Attacker objective owner"/);
  assert.match(html, /aria-label="Target objective owner"/);
  assert.match(html, /aria-label="Target is the closest eligible target"/);
  assert.match(html, /LIVE RESOLUTION/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders every battle workflow", async () => {
  for (const [pathname, heading] of [
    ["/model-vs-model", "Damage Calculator"],
    ["/unit-vs-unit", "Unit vs Unit"],
    ["/lists", "Army Lists"],
    ["/play", "Play Mode"],
    ["/agent", "Parameterized Calculator"],
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(heading, "i"));
    if (pathname === "/lists") {
      assert.match(html, /Export backup/);
      assert.match(html, /Import backup/);
    }
    if (pathname === "/play") {
      assert.match(html, /Reset battle/);
      assert.match(html, /recover automatically/i);
      assert.match(html, /limited supporting-ability uses/i);
      assert.match(html, /<legend>Attacker<\/legend>/);
      assert.match(html, /<legend>Target<\/legend>/);
      assert.match(html, /role="status"/);
      assert.match(html, /aria-live="polite"/);
      assert.match(html, /Quick overrides/);
      assert.match(html, /play-action-hint/);
      assert.match(html, /aria-label="Target distance in inches"/);
      assert.match(html, /aria-label="Attacker-side source to target distance in inches"/);
      assert.match(html, /aria-label="Target visible to attacker-side source"/);
      assert.match(html, /aria-label="Target-side source to attacker distance in inches"/);
      assert.match(html, /aria-label="Attacker visible to target-side source"/);
      assert.match(html, /aria-label="Models in the attacker unit"/);
      assert.match(html, /aria-label="Enemy models within the ability range"/);
      assert.match(html, /aria-label="Attacker is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is the Oath of Moment target"/);
      assert.match(html, /aria-label="Attacker is within range of an objective marker"/);
      assert.match(html, /aria-label="Target is within range of an objective marker"/);
      assert.match(html, /aria-label="Attacker objective owner"/);
      assert.match(html, /aria-label="Target objective owner"/);
      assert.match(html, /aria-label="Attacker qualifies for the Codex Oath wound bonus"/);
      assert.match(html, /aria-label="Target is the closest eligible target"/);
    }
    if (pathname === "/unit-vs-unit") {
      assert.match(html, /aria-label="Target distance in inches"/);
      assert.match(html, /aria-label="Attacker-side source to target distance in inches"/);
      assert.match(html, /aria-label="Target visible to attacker-side source"/);
      assert.match(html, /aria-label="Target-side source to attacker distance in inches"/);
      assert.match(html, /aria-label="Attacker visible to target-side source"/);
      assert.match(html, /aria-label="Models in the attacker unit"/);
      assert.match(html, /aria-label="Enemy models within the ability range"/);
      assert.match(html, /aria-label="Attacker is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is the Oath of Moment target"/);
      assert.match(html, /aria-label="Attacker is within range of an objective marker"/);
      assert.match(html, /aria-label="Target is within range of an objective marker"/);
      assert.match(html, /aria-label="Attacker objective owner"/);
      assert.match(html, /aria-label="Target objective owner"/);
      assert.match(html, /aria-label="Attacker qualifies for the Codex Oath wound bonus"/);
      assert.match(html, /aria-label="Target is the closest eligible target"/);
    }
    if (pathname === "/agent") {
      assert.match(html, /Call with a URL/);
      assert.match(html, /MACHINE-READABLE OUTPUT/);
      assert.match(html, /Doom Scythe/);
    }
  }
});

test("serves profile discovery, exact calculation, and CSPRNG roll APIs", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };

  const docs = await worker.fetch(new Request("http://localhost/api/v1"), testEnv, context);
  assert.equal(docs.status, 200);
  assert.equal(docs.headers.get("access-control-allow-origin"), "*");
  const documented = await docs.json();
  assert.equal(documented.apiVersion, "v1");
  assert.match(documented.endpoints.calculate, /POST \/api\/v1\/calculate/);
  assert.match(documented.endpoints.volleyComplexity, /POST \/api\/v1\/volley\/complexity/);
  assert.match(documented.endpoints.volleySimulate, /POST \/api\/v1\/volley\/simulate/);
  assert.match(documented.endpoints.firingDeck, /GET \/api\/v1\/firing-deck/);
  assert.match(documented.endpoints.validateFiringDeck, /POST \/api\/v1\/validate-firing-deck/);
  assert.match(documented.endpoints.lists, /lists\/export/);

  const factions = await worker.fetch(
    new Request("http://localhost/api/v1/factions"),
    testEnv,
    context,
  );
  assert.equal(factions.status, 200);
  assert.ok((await factions.json()).data.length > 20);

  const profiles = await worker.fetch(
    new Request("http://localhost/api/v1/profiles"),
    testEnv,
    context,
  );
  const catalogue = await profiles.json();
  const warriors = catalogue.units.find((unit) => unit.name === "Necron Warriors");
  assert.ok(warriors);
  const trukk = catalogue.units.find((unit) => unit.id === "000000026");
  const boyz = catalogue.units.find((unit) => unit.id === "000000016");
  assert.deepEqual(trukk.firingDeck, { capacity: 12, abilityId: "000008334" });
  const firingDeck = await worker.fetch(
    new Request(`http://localhost/api/v1/firing-deck?unit=${trukk.id}&passenger=${boyz.id}`),
    testEnv,
    context,
  );
  assert.equal(firingDeck.status, 200);
  const firingDeckBody = await firingDeck.json();
  assert.equal(firingDeckBody.data.capacity, 12);
  assert.equal(
    firingDeckBody.data.passenger.weapons.some((weapon) => weapon.name === "Choppa"),
    false,
  );
  const validatedDeck = await worker.fetch(
    new Request("http://localhost/api/v1/validate-firing-deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transportId: trukk.id,
        selections: [
          { passengerUnitId: boyz.id, weaponId: 59, modelCount: 12, unitAlreadyShot: false },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(validatedDeck.status, 200);
  assert.deepEqual((await validatedDeck.json()).data, {
    capacity: 12,
    slotsUsed: 12,
    selections: [
      {
        passengerUnitId: boyz.id,
        passengerUnitName: "Boyz",
        weaponId: 59,
        weaponName: "Shoota",
        modelCount: 12,
        modelCost: 1,
        slots: 12,
        bearerUnitId: trukk.id,
      },
    ],
  });
  const invalidDeck = await worker.fetch(
    new Request("http://localhost/api/v1/validate-firing-deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transportId: trukk.id,
        selections: [{ passengerUnitId: boyz.id, weaponId: 59, modelCount: 13 }],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalidDeck.status, 400);
  assert.match((await invalidDeck.text()).toLowerCase(), /allows 12/);
  const warboss = catalogue.units.find((unit) => unit.name === "Warboss");
  const mightIsRight = warboss.combatPresets.find((preset) => preset.name === "Might is Right");
  assert.equal(mightIsRight.hitModifierRole, "attacker");
  assert.equal(mightIsRight.hitModifierSubject, "led_unit");
  const castigator = catalogue.units.find((unit) => unit.name === "Castigator");
  const rites = castigator.combatPresets.find((preset) => preset.name === "Rites of Castigation");
  assert.deepEqual(rites.effects, [
    {
      type: "ap_modifier",
      value: 1,
      diceCount: 0,
      diceSides: 0,
      role: "attacker",
      subject: "friendly_unit",
    },
  ]);
  const captainTycho = catalogue.units.find((unit) => unit.id === "000000152");
  const embittered = captainTycho.combatPresets.find((preset) => preset.name === "Embittered");
  assert.deepEqual(embittered.effects, [
    {
      type: "attacks_replacement",
      value: 12,
      diceCount: 0,
      diceSides: 0,
      weaponName: "Dead Man’s Hand",
      role: "attacker",
      subject: "self",
    },
  ]);
  const harker = catalogue.units.find((unit) => unit.name === "Sergeant Harker");
  const payback = harker.combatPresets.find((preset) => preset.name === "Payback Time");
  assert.equal(payback.activation, "situational");
  assert.equal(payback.weaponScope, "Ranged");
  assert.deepEqual(
    payback.effects.map((effect) => [effect.type, effect.value, effect.weaponName]),
    [
      ["attacks_replacement", 6, "Payback"],
      ["sustained_hits", 3, "Payback"],
    ],
  );
  const trajann = catalogue.units.find((unit) => unit.name === "Trajann Valoris");
  const momentShackle = trajann.combatPresets.filter((preset) =>
    preset.name.startsWith("Moment Shackle —"),
  );
  assert.equal(momentShackle.length, 2);
  assert.equal(new Set(momentShackle.map((preset) => preset.choiceGroup)).size, 1);
  assert.equal(
    momentShackle.find((preset) => preset.name.endsWith("Invulnerable 2+")).weaponScope,
    "Melee",
  );
  const culexus = catalogue.units.find((unit) => unit.name === "Culexus Assassin");
  const psychicAssassin = culexus.combatPresets.find(
    (preset) => preset.name === "Psychic Assassin",
  );
  assert.equal(psychicAssassin.activation, "automatic");
  assert.deepEqual(psychicAssassin.effects, [
    {
      type: "attacks_replacement",
      value: 6,
      diceCount: 0,
      diceSides: 0,
      weaponName: "Animus speculum",
      requiredTargetKeyword: "psyker",
      role: "attacker",
      subject: "self",
    },
  ]);
  const abomination = culexus.combatPresets.find((preset) => preset.name === "Abomination");
  assert.equal(abomination.activation, "automatic");
  assert.deepEqual(abomination.effects, [
    {
      type: "feel_no_pain",
      value: 2,
      diceCount: 0,
      diceSides: 0,
      requiredAttackKeyword: "psychic",
      role: "target",
      subject: "self",
    },
  ]);
  const eldrad = catalogue.units.find((unit) => unit.name === "Eldrad Ulthran");
  const doom = eldrad.combatPresets.find((preset) => preset.name === "Doom (Psychic)");
  assert.equal(doom.sourceRelationship, "self_or_supporting_unit");
  assert.deepEqual(doom.requiredAttackerKeywords, ["aeldari"]);
  const lordOfVirulence = catalogue.units.find((unit) => unit.name === "Lord of Virulence");
  const blight = lordOfVirulence.combatPresets.find(
    (preset) => preset.name === "Blight Bombardment",
  );
  assert.deepEqual(blight.requiredAttackerKeywords, ["death guard"]);
  assert.deepEqual(blight.effects, [
    {
      type: "reroll_hits",
      value: 1,
      diceCount: 0,
      diceSides: 0,
      requiredAttackKeyword: "blast",
      role: "attacker",
      subject: "friendly_unit",
    },
  ]);
  const marshal = catalogue.units.find((unit) => unit.name === "Marshal");
  const piousFervour = marshal.combatPresets.find((preset) => preset.name === "Pious Fervour");
  assert.equal(piousFervour.activation, "automatic");
  assert.deepEqual(
    piousFervour.effects.map((effect) => [
      effect.modelCountSource,
      effect.modelsPerIncrement,
      effect.maximumModifier,
      effect.weaponName,
    ]),
    [["nearby_enemy_units", 1, 3, "master-crafted power weapon"]],
  );
  const huntaRig = catalogue.units.find((unit) => unit.name === "Hunta Rig");
  const onDaHunt = huntaRig.combatPresets.find((preset) => preset.name === "On Da Hunt");
  assert.deepEqual(
    onDaHunt.effects.map((effect) => [
      effect.modelCountSource,
      effect.modelsPerIncrement,
      effect.maximumModifier,
      effect.weaponName,
    ]),
    [["embarked_models", 1, 6, "butcha boyz"]],
  );
  const raider = catalogue.units.find((unit) => unit.name === "Raider");
  const visions = raider.combatPresets.find((preset) => preset.name === "Visions of Butchery");
  assert.deepEqual(
    visions.effects.map((effect) => [effect.modelCountSource, effect.weaponName]),
    [["embarked_wracks_models", "bladevanes and chainsnares"]],
  );
  const captain = catalogue.units.find((unit) => unit.id === "000000073");
  const finestHour = captain.combatPresets.find((preset) => preset.name === "Finest Hour");
  assert.equal(finestHour.weaponScope, "Melee");
  assert.deepEqual(
    finestHour.effects.map((effect) => [effect.type, effect.value, effect.role, effect.subject]),
    [
      ["devastating_wounds", 1, "attacker", "self"],
      ["attacks_modifier", 3, "attacker", "self"],
    ],
  );
  const redemptor = catalogue.units.find((unit) => unit.name === "Redemptor Dreadnought");
  const dutyEternal = redemptor.combatPresets.find((preset) => preset.name === "Duty Eternal");
  assert.equal(dutyEternal.activation, "inherent");
  assert.equal(redemptor.models[0].reduction, 1);
  assert.equal(redemptor.models[0].feelNoPain, 0);
  assert.deepEqual(
    dutyEternal.effects.map((effect) => [effect.type, effect.value, effect.role]),
    [["damage_reduction", 1, "target"]],
  );
  assert.equal(
    catalogue.units.some((unit) =>
      unit.combatPresets.some((preset) => preset.name === "Impossible Form (Psychic)"),
    ),
    false,
  );
  const loadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${warriors.id}`),
    testEnv,
    context,
  );
  assert.equal(loadout.status, 200);
  const loadoutData = (await loadout.json()).data;
  assert.equal(loadoutData.suggestedModelCount, 10);
  assert.equal(loadoutData.maximumModelCount, 20);
  assert.match(loadoutData.composition[0].text, /10-20 Necron Warriors/i);
  assert.match(loadoutData.loadout, /Every model is equipped with.*gauss flayer/i);
  assert.equal(
    loadoutData.defaultWeapons.find((weapon) => weapon.groupName === "Gauss flayer").terms[0]
      .perModel,
    1,
  );
  assert.ok(loadoutData.wargearOptions.some((option) => /gauss reaper/i.test(option)));
  const reaperLimit = loadoutData.weaponLimits.find((limit) => limit.groupName === "Gauss reaper");
  assert.ok(reaperLimit);
  assert.equal(reaperLimit.terms[0].modelsPerIncrement, 1);

  const invalidLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { [reaperLimit.groupId]: 11 },
        optionCounts: { [reaperLimit.groupId]: 11 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalidLoadout.status, 200);
  const invalidLoadoutData = (await invalidLoadout.json()).data;
  assert.equal(invalidLoadoutData.valid, false);
  assert.match(invalidLoadoutData.warnings[0], /limit of 10/i);

  const standardEquipment = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { [reaperLimit.groupId]: 10 },
        optionCounts: { [reaperLimit.groupId]: 0 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal((await standardEquipment.json()).data.valid, true);

  const accursed = catalogue.units.find((unit) => unit.name === "Accursed Cultists");
  const tormentSubject = accursed.unresolvedLoadoutSubjects.find(
    (subject) => subject.subject === "Every Torment",
  );
  const mutationGroup = tormentSubject.weapons[0].groupId;
  const explicitComposition = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: accursed.id,
        modelCount: 8,
        weaponCounts: { [mutationGroup]: 3 },
        loadoutSubjectCounts: { [tormentSubject.id]: 3 },
      }),
    }),
    testEnv,
    context,
  );
  const explicitCompositionData = (await explicitComposition.json()).data;
  assert.equal(explicitCompositionData.valid, true);
  assert.equal(explicitCompositionData.compositionWeaponCounts[mutationGroup], 3);
  assert.equal(explicitCompositionData.suggestedEquippedCounts[mutationGroup], 3);

  const impossibleComposition = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: accursed.id,
        modelCount: 8,
        weaponCounts: { [mutationGroup]: 9 },
        loadoutSubjectCounts: { [tormentSubject.id]: 9 },
      }),
    }),
    testEnv,
    context,
  );
  const impossibleCompositionData = (await impossibleComposition.json()).data;
  assert.equal(impossibleCompositionData.valid, false);
  assert.match(impossibleCompositionData.warnings[0], /exceeds the unit total/i);

  const achillus = catalogue.units.find((unit) => unit.name === "Contemptor-achillus Dreadnought");
  const achillusPool = achillus.wargearChoicePools[0];
  assert.equal(achillusPool.alternatives.length, 5);
  const infernusGroup = achillus.weapons.find(
    (weapon) => weapon.groupName === "Infernus incinerator",
  ).groupId;
  const lastrumGroup = achillus.weapons.find(
    (weapon) => weapon.groupName === "Lastrum storm bolter",
  ).groupId;
  assert.deepEqual(achillusPool.replaces, [
    { groupId: lastrumGroup, groupName: "Lastrum storm bolter", quantity: 2 },
  ]);
  const doubleInfernus = achillusPool.alternatives.find((alternative) =>
    /^2 infernus incinerators$/i.test(alternative.label),
  );
  const validBundle = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: achillus.id,
        modelCount: 1,
        weaponCounts: { [infernusGroup]: 2 },
        choiceSelections: { [doubleInfernus.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  const validBundleData = (await validBundle.json()).data;
  assert.equal(validBundleData.valid, true);
  assert.equal(validBundleData.selectedWeaponCounts[infernusGroup], 2);
  assert.equal(validBundleData.suggestedEquippedCounts[lastrumGroup], 0);
  assert.equal(validBundleData.suggestedEquippedCounts[infernusGroup], 2);
  const invalidSharedPool = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: achillus.id,
        modelCount: 1,
        weaponCounts: { [infernusGroup]: 4 },
        choiceSelections: { [doubleInfernus.id]: 2 },
      }),
    }),
    testEnv,
    context,
  );
  const invalidSharedPoolData = (await invalidSharedPool.json()).data;
  assert.equal(invalidSharedPoolData.valid, false);
  assert.match(invalidSharedPoolData.warnings[0], /shared limit of 1/i);

  const unknownWeapon = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { "not-a-weapon": 1 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(unknownWeapon.status, 400);
  assert.match((await unknownWeapon.json()).error.message, /weapon group ids/i);

  const overriddenCasualties = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId: warriors.id, modelCount: 7, weaponCounts: {} }),
    }),
    testEnv,
    context,
  );
  assert.match((await overriddenCasualties.json()).data.warnings[0], /battlefield casualties/i);

  const cadian = catalogue.units.find((unit) => unit.name === "Cadian Shock Troops");
  const cadianLoadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${cadian.id}`),
    testEnv,
    context,
  );
  const cadianData = (await cadianLoadout.json()).data;
  assert.equal(cadianData.suggestedModelCount, 10);
  assert.equal(cadianData.maximumModelCount, 20);
  assert.ok(cadianData.compositionModels.some((model) => model.name === "Shock Troopers"));
  const cadianDefaults = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId: cadian.id, modelCount: 20, weaponCounts: {} }),
    }),
    testEnv,
    context,
  );
  const cadianDefaultCounts = (await cadianDefaults.json()).data.suggestedEquippedCounts;
  const lasgunGroup = cadian.weapons.find((weapon) => weapon.groupName === "Lasgun").groupId;
  assert.equal(cadianDefaultCounts[lasgunGroup], 18);

  const sisters = catalogue.units.find((unit) => unit.name === "Battle Sisters Squad");
  const sisterUnits = await worker.fetch(
    new Request(`http://localhost/api/v1/units?faction=${sisters.factionId}&kind=attacker`),
    testEnv,
    context,
  );
  const sistersSummary = (await sisterUnits.json()).data.find((unit) => unit.id === sisters.id);
  assert.ok(sistersSummary.weaponGroupCount < sistersSummary.weaponProfileCount);
  const sistersLoadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${sisters.id}`),
    testEnv,
    context,
  );
  const plasmaProfiles = (await sistersLoadout.json()).data.weapons.filter(
    (weapon) => weapon.groupName === "Plasma pistol",
  );
  assert.equal(plasmaProfiles.length, 2);
  assert.equal(new Set(plasmaProfiles.map((weapon) => weapon.groupId)).size, 1);
  assert.deepEqual(
    new Set(plasmaProfiles.map((weapon) => weapon.profileName)),
    new Set(["standard", "supercharge"]),
  );

  const calculate = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: {} }),
    }),
    testEnv,
    context,
  );
  const calculateBody = await calculate.text();
  assert.equal(calculate.status, 200, calculateBody);
  const calculated = JSON.parse(calculateBody);
  assert.ok(calculated.data.mean > 0);
  assert.match(calculated.data.exact.numerator, /^\d+$/);
  assert.ok(calculated.data.applied.mean > 0);
  assert.ok(calculated.data.applied.mean <= calculated.data.mean);
  assert.match(calculated.data.applied.estimated.numerator, /^\d+$/);

  const signedProfile = {
    attackDice: 1,
    attackSides: 6,
    attacks: 0,
    attacksModifier: -100,
    weaponCount: 2,
    hitOn: 2,
    strength: 10,
    ap: 0,
    damageDice: 0,
    damageSides: 0,
    damage: 1,
    toughness: 1,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    wounds: 10,
    targetModels: 1,
    torrent: true,
  };
  const signedCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: signedProfile }),
    }),
    testEnv,
    context,
  );
  const signedCalculationBody = await signedCalculation.json();
  assert.equal(signedCalculation.status, 200);
  assert.deepEqual(signedCalculationBody.data.exact, { numerator: "5", denominator: "3" });

  const replacementProfile = {
    ...signedProfile,
    attacksReplacement: 4,
    attacksModifier: -1,
  };
  const replacementCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: replacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementCalculation.status, 200);
  assert.deepEqual((await replacementCalculation.json()).data.exact, {
    numerator: "5",
    denominator: "1",
  });

  const firstFailedSaveProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 2,
    attacksModifier: 0,
    weaponCount: 1,
    damage: 3,
    firstFailedSaveDamageReplacement: 0,
    wounds: 20,
  };
  const firstFailedSaveCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: firstFailedSaveProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(firstFailedSaveCalculation.status, 200);
  const firstFailedSaveExact = (await firstFailedSaveCalculation.json()).data;
  assert.equal(firstFailedSaveExact.maximum, 3);
  assert.ok(Math.abs(firstFailedSaveExact.mean - 25 / 12) < 1e-8);

  const firstFailedSaveSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [firstFailedSaveProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 20,
            reduction: 0,
            damageDivisor: 1,
            firstFailedSaveDamageReplacement: 0,
            modelCount: 1,
          },
        ],
        seed: 404,
        trials: 10_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(firstFailedSaveSimulation.status, 200);
  const firstFailedSaveSimulated = (await firstFailedSaveSimulation.json()).data;
  assert.ok(
    Math.abs(firstFailedSaveSimulated.mean - 25 / 12) < 0.08,
    JSON.stringify(firstFailedSaveSimulated),
  );

  const allocatedReplacementProfile = {
    ...firstFailedSaveProfile,
    firstFailedSaveDamageReplacement: null,
    torrent: true,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 2,
    allocatedAttackDamageReplacementSkip: 0,
  };
  const allocatedReplacementCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: allocatedReplacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(allocatedReplacementCalculation.status, 200);
  assert.equal((await allocatedReplacementCalculation.json()).data.maximum, 0);
  const allocatedReplacementSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [allocatedReplacementProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 20,
            reduction: 0,
            damageDivisor: 1,
            firstFailedSaveDamageReplacement: null,
            allocatedAttackDamageReplacement: 0,
            allocatedAttackDamageReplacementUses: 2,
            allocatedAttackDamageReplacementSkip: 0,
            modelCount: 1,
          },
        ],
        seed: 405,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(allocatedReplacementSimulation.status, 200);
  assert.equal((await allocatedReplacementSimulation.json()).data.maximum, 0);

  const zeroDamageReplacement = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    strength: 2,
    strengthReplacement: 8,
    strengthModifier: -1,
    damageDice: 1,
    damageSides: 6,
    damage: 0,
    damageReplacement: 0,
    damageModifier: 0,
    toughness: 7,
  };
  const zeroDamageCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: zeroDamageReplacement }),
    }),
    testEnv,
    context,
  );
  assert.equal(zeroDamageCalculation.status, 200);
  assert.deepEqual((await zeroDamageCalculation.json()).data.exact, {
    numerator: "0",
    denominator: "1",
  });

  const meltaAfterReplacement = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: { ...zeroDamageReplacement, withinHalfRange: true, melta: 2 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(meltaAfterReplacement.status, 200);
  assert.deepEqual((await meltaAfterReplacement.json()).data.exact, {
    numerator: "1",
    denominator: "1",
  });

  const dividedDamageProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    damage: 5,
    damageModifier: 1,
    damageDivisor: 2,
  };
  const dividedDamageCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: dividedDamageProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(dividedDamageCalculation.status, 200);
  assert.deepEqual((await dividedDamageCalculation.json()).data.exact, {
    numerator: "10",
    denominator: "3",
  });

  const multipliedProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 3,
    attacksMultiplier: 2,
    attacksModifier: 1,
    weaponCount: 1,
    strength: 4,
    strengthMultiplier: 2,
    strengthModifier: 1,
    toughness: 8,
    damage: 5,
    damageMultiplier: 2,
    damageModifier: 1,
    damageDivisor: 2,
  };
  const multipliedCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: multipliedProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(multipliedCalculation.status, 200);
  assert.deepEqual((await multipliedCalculation.json()).data.exact, {
    numerator: "28",
    denominator: "1",
  });
  const multipliedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [multipliedProfile],
        targets: [
          {
            toughness: 8,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 100,
            reduction: 0,
            damageDivisor: 2,
            modelCount: 1,
          },
        ],
        seed: 1701,
        trials: 5000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(multipliedSimulation.status, 200);
  assert.ok(Math.abs((await multipliedSimulation.json()).data.mean - 28) < 0.25);

  const sharedCharacteristicProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    strength: 3,
    strengthModifier: 0,
    toughness: 5,
    damage: 1,
    characteristicModifierDice: 1,
    characteristicModifierSides: 3,
    characteristicModifierBonus: 0,
    characteristicModifierAttacks: true,
    characteristicModifierStrength: true,
    characteristicModifierDamage: false,
  };
  const sharedCharacteristicCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: sharedCharacteristicProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(sharedCharacteristicCalculation.status, 200);
  assert.deepEqual((await sharedCharacteristicCalculation.json()).data.exact, {
    numerator: "29",
    denominator: "18",
  });
  const sharedCharacteristicSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [sharedCharacteristicProfile],
        targets: [
          {
            toughness: 5,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 100,
            reduction: 0,
            damageDivisor: 1,
            modelCount: 1,
          },
        ],
        seed: 1701,
        trials: 10000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(sharedCharacteristicSimulation.status, 200);
  assert.ok(Math.abs((await sharedCharacteristicSimulation.json()).data.mean - 29 / 18) < 0.04);

  const groupedProfiles = [
    { ...sharedCharacteristicProfile, characteristicModifierGroup: "shared-d3" },
    { ...sharedCharacteristicProfile, characteristicModifierGroup: "shared-d3" },
  ];
  const groupedTargets = [
    {
      toughness: 5,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 2,
      reduction: 0,
      damageDivisor: 1,
      modelCount: 1,
    },
  ];
  const volleyResult = async (path, profiles, extra = {}) => {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles, targets: groupedTargets, ...extra }),
      }),
      testEnv,
      context,
    );
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };
  const groupedExact = await volleyResult("/api/v1/volley", groupedProfiles);
  const independentProfiles = [
    groupedProfiles[0],
    { ...groupedProfiles[1], characteristicModifierGroup: "another-d3" },
  ];
  const independentExact = await volleyResult("/api/v1/volley", independentProfiles);
  assert.notEqual(groupedExact.mean, independentExact.mean);
  const groupedSimulation = await volleyResult("/api/v1/volley/simulate", groupedProfiles, {
    seed: 1701,
    trials: 20000,
  });
  const independentSimulation = await volleyResult("/api/v1/volley/simulate", independentProfiles, {
    seed: 1701,
    trials: 20000,
  });
  assert.ok(Math.abs(groupedSimulation.mean - groupedExact.mean) < 0.025);
  assert.ok(Math.abs(independentSimulation.mean - independentExact.mean) < 0.025);

  const simulateDamageDivisor = async (damageDivisor) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [{ ...dividedDamageProfile, damageDivisor: 1 }],
          targets: [
            {
              toughness: 1,
              save: 7,
              invulnerable: 0,
              feelNoPain: 0,
              wounds: 1000,
              reduction: 0,
              damageDivisor,
              modelCount: 1,
            },
          ],
          seed: 17,
          trials: 100,
        }),
      }),
      testEnv,
      context,
    );
    assert.equal(response.status, 200);
    return (await response.json()).data.mean;
  };
  const undividedSimulationMean = await simulateDamageDivisor(1);
  const dividedSimulationMean = await simulateDamageDivisor(2);
  assert.equal(dividedSimulationMean * 1.5, undividedSimulationMean);

  const volleyProfile = (ap, damage) => ({
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    weaponCount: 1,
    hitOn: 2,
    strength: 10,
    ap,
    damageDice: 0,
    damageSides: 0,
    damage,
    torrent: true,
  });
  const volleyTargets = [
    {
      toughness: 1,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 1,
      reduction: 0,
      modelCount: 1,
    },
    {
      toughness: 1,
      save: 2,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 2,
      reduction: 0,
      modelCount: 1,
    },
  ];
  const requestVolley = async (profiles, targets = volleyTargets, initialWoundsLost = 0) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/volley", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles, targets, initialWoundsLost }),
      }),
      testEnv,
      context,
    );
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text).data;
  };
  const rapidReplacementVolley = await requestVolley(
    [
      {
        ...replacementProfile,
        weaponCount: 1,
        withinHalfRange: true,
        rapidFireDice: 1,
        rapidFireSides: 3,
        rapidFire: 0,
      },
    ],
    [
      {
        toughness: 1,
        save: 7,
        invulnerable: 0,
        feelNoPain: 0,
        wounds: 10,
        reduction: 0,
        modelCount: 1,
      },
    ],
  );
  assert.equal(rapidReplacementVolley.maximum, 6);
  assert.ok(Math.abs(rapidReplacementVolley.mean - 25 / 6) < 1e-8);
  const forwardVolley = await requestVolley([volleyProfile(0, 1), volleyProfile(6, 2)]);
  const reverseVolley = await requestVolley([volleyProfile(6, 2), volleyProfile(0, 1)]);
  assert.ok(forwardVolley.mean > reverseVolley.mean);
  assert.equal(forwardVolley.maximum, 3);
  assert.equal(forwardVolley.cumulative.length, 2);
  const partialVolley = await requestVolley(
    [volleyProfile(6, 2)],
    [{ ...volleyTargets[1], save: 7, modelCount: 2 }],
    1,
  );
  assert.equal(partialVolley.maximum, 1);

  const volleyRoll = await worker.fetch(
    new Request("http://localhost/api/v1/volley/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [volleyProfile(0, 1), volleyProfile(6, 2)],
        targets: volleyTargets,
        initialWoundsLost: 0,
      }),
    }),
    testEnv,
    context,
  );
  const volleyRollText = await volleyRoll.text();
  assert.equal(volleyRoll.status, 200, volleyRollText);
  const volleyRolled = JSON.parse(volleyRollText).data;
  assert.equal(volleyRolled.lines.length, 2);
  assert.ok(volleyRolled.appliedDamage >= 0 && volleyRolled.appliedDamage <= 3);
  assert.equal(
    volleyRolled.appliedDamage,
    volleyRolled.lines.reduce((total, line) => total + line.appliedDamage, 0),
  );
  assert.ok(volleyRolled.lines.every((line) => line.details.length === 0));

  const simulationRequest = () =>
    worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [volleyProfile(0, 1), volleyProfile(6, 2)],
          targets: volleyTargets,
          initialWoundsLost: 0,
          seed: 0x40_000,
          trials: 20_000,
        }),
      }),
      testEnv,
      context,
    );
  const firstSimulationResponse = await simulationRequest();
  const firstSimulationText = await firstSimulationResponse.text();
  assert.equal(firstSimulationResponse.status, 200, firstSimulationText);
  const firstSimulation = JSON.parse(firstSimulationText).data;
  const secondSimulation = (await (await simulationRequest()).json()).data;
  assert.deepEqual(secondSimulation, firstSimulation);
  assert.equal(firstSimulation.algorithm, "xoshiro128ss-v1");
  assert.equal(firstSimulation.seed, 0x40_000);
  assert.equal(
    firstSimulation.histogram.reduce((total, bucket) => total + bucket.count, 0),
    firstSimulation.trials,
  );
  assert.ok(Math.abs(firstSimulation.mean - forwardVolley.mean) < 0.06);
  assert.ok(firstSimulation.zeroDamageChance >= 0 && firstSimulation.zeroDamageChance <= 1);
  assert.ok(firstSimulation.unitDestroyedChance >= 0 && firstSimulation.unitDestroyedChance <= 1);

  const devastatingLastProfiles = [
    {
      ...volleyProfile(0, 2),
      criticalWounds: 2,
      devastatingWounds: true,
    },
    volleyProfile(0, 3),
  ];
  const devastatingLastTargets = [
    {
      toughness: 1,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 3,
      reduction: 0,
      modelCount: 2,
    },
  ];
  const devastatingLastExact = await requestVolley(devastatingLastProfiles, devastatingLastTargets);
  assert.equal(devastatingLastExact.maximum, 5);
  assert.equal(devastatingLastExact.peakSparseStates, 4);
  assert.ok(Math.abs(devastatingLastExact.mean - 25 / 6) < 1e-8, devastatingLastExact.mean);

  const complexityResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: devastatingLastProfiles,
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const complexityText = await complexityResponse.text();
  assert.equal(complexityResponse.status, 200, complexityText);
  const complexity = JSON.parse(complexityText).data;
  assert.equal(complexity.usesDeferredStates, true);
  assert.equal(complexity.exactGuaranteedByBound, true);
  assert.equal(complexity.estimatedStateUpperBound, 112);
  assert.equal(complexity.stateLimit, 2047);
  assert.equal(complexity.estimateKind, "prefix-aware-conservative-upper-bound");
  assert.equal(complexity.fallbackEndpoint, "/api/v1/volley/simulate");

  const highComplexityResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ ...devastatingLastProfiles[0], attacks: 20 }, devastatingLastProfiles[1]],
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const highComplexity = (await highComplexityResponse.json()).data;
  assert.equal(highComplexity.exactGuaranteedByBound, false);
  assert.ok(highComplexity.estimatedStateUpperBound > highComplexity.stateLimit);

  const tightenedResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ ...volleyProfile(0, 1), attacks: 8 }, devastatingLastProfiles[0]],
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const tightened = (await tightenedResponse.json()).data;
  assert.equal(tightened.estimatedStateUpperBound, 1134);
  assert.equal(tightened.exactGuaranteedByBound, true);

  const overflowingProfile = {
    ...volleyProfile(4, 0),
    attackDice: 1,
    attackSides: 6,
    attacks: 0,
    damageDice: 1,
    damageSides: 6,
    criticalHits: 5,
    criticalWounds: 5,
    lethalHits: true,
    devastatingWounds: true,
    sustainedHitsDice: 1,
    sustainedHitsSides: 3,
  };
  const exactLimitResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: Array.from({ length: 4 }, () => overflowingProfile),
        targets: [{ ...devastatingLastTargets[0], feelNoPain: 6, modelCount: 20 }],
      }),
    }),
    testEnv,
    context,
  );
  const exactLimit = await exactLimitResponse.json();
  assert.equal(exactLimitResponse.status, 422);
  assert.equal(exactLimit.error.code, "EXACT_STATE_LIMIT");
  assert.match(exactLimit.error.message, /volley\/simulate/);

  const devastatingLastResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: devastatingLastProfiles,
        targets: devastatingLastTargets,
        seed: 0xd3_7a_51,
        trials: 20_000,
      }),
    }),
    testEnv,
    context,
  );
  const devastatingLastText = await devastatingLastResponse.text();
  assert.equal(devastatingLastResponse.status, 200, devastatingLastText);
  const devastatingLast = JSON.parse(devastatingLastText).data;
  assert.ok(Math.abs(devastatingLast.mean - 25 / 6) < 0.04, devastatingLast.mean);
  const replaySnapshot = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [
          {
            attackDice: 0,
            attacks: 4,
            weaponCount: 1,
            hitOn: 3,
            strength: 10,
            ap: 0,
            damageDice: 0,
            damageSides: 0,
            damage: 2,
          },
        ],
        targets: [
          {
            toughness: 10,
            save: 3,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 12,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 0x40_000,
        trials: 1_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.deepEqual((await replaySnapshot.json()).data.histogram, [
    { damage: 0, count: 659, probability: 0.659 },
    { damage: 2, count: 271, probability: 0.271 },
    { damage: 4, count: 64, probability: 0.064 },
    { damage: 6, count: 6, probability: 0.006 },
  ]);
  const oversizedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [
          {
            attackDice: 20,
            attackSides: 100,
            attacks: 1024,
            weaponCount: 100,
            sustainedHitsDice: 20,
            sustainedHitsSides: 100,
            sustainedHits: 1024,
          },
        ],
        targets: volleyTargets,
        seed: 1,
        trials: 100_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(oversizedSimulation.status, 400);
  assert.match(await oversizedSimulation.text(), /simulation is too large/i);

  const roll = await worker.fetch(
    new Request("http://localhost/api/v1/roll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: {} }),
    }),
    testEnv,
    context,
  );
  const rollBody = await roll.text();
  assert.equal(roll.status, 200, rollBody);
  const rolled = JSON.parse(rollBody);
  assert.equal(rolled.data.attacks, 4);
  assert.ok(rolled.data.attacksResolved >= 1 && rolled.data.attacksResolved <= 4);
  assert.ok(rolled.data.details.length >= rolled.data.attacksResolved);
  assert.ok(rolled.data.appliedDamage <= rolled.data.totalDamage);
  assert.ok(rolled.data.modelsDestroyed <= 1);

  const signedRoll = await worker.fetch(
    new Request("http://localhost/api/v1/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: signedProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(signedRoll.status, 200);
  assert.equal((await signedRoll.json()).data.attacks, 2);

  const signedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [signedProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 10,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 1,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(signedSimulation.status, 200);
  assert.equal((await signedSimulation.json()).data.means.attacksResolved, 2);

  const replacementRoll = await worker.fetch(
    new Request("http://localhost/api/v1/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: replacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementRoll.status, 200);
  assert.equal((await replacementRoll.json()).data.attacks, 6);

  const replacementSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [replacementProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 10,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 1,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementSimulation.status, 200);
  assert.equal((await replacementSimulation.json()).data.means.attacksResolved, 6);
});

test("API exact and seeded simulation paths match the shared rules interaction corpus", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const profileFor = (testCase) => ({
    attackDice: 0,
    attackSides: 0,
    attacks: testCase.attacks,
    weaponCount: 1,
    hitOn: testCase.hitOn,
    strength: testCase.strength,
    ap: testCase.ap,
    damageDice: 0,
    damageSides: 0,
    damage: testCase.damage,
    criticalHits: testCase.criticalHits,
    toughness: testCase.toughness,
    save: testCase.save,
    invulnerable: testCase.invulnerable,
    feelNoPain: testCase.feelNoPain,
    wounds: testCase.wounds,
    targetModels: testCase.targetModels,
    criticalWounds: testCase.criticalWounds,
    sustainedHits: testCase.sustainedHits,
    hitModifier: testCase.hitModifier,
    woundModifier: testCase.woundModifier,
    lethalHits: (testCase.flags & 1) !== 0,
    devastatingWounds: (testCase.flags & 2) !== 0,
    twinLinked: (testCase.flags & 4) !== 0,
    rerollHits: (testCase.flags & 8) !== 0,
    torrent: (testCase.flags & 16) !== 0,
    heavyActive: (testCase.flags & 32) !== 0,
    lanceActive: (testCase.flags & 64) !== 0,
    ignoresCover: (testCase.flags & 2048) !== 0,
    indirect: (testCase.flags & 4096) !== 0,
    rerollHitOnes: (testCase.flags & 8192) !== 0,
    rerollWounds: (testCase.flags & 16384) !== 0,
    rerollWoundOnes: (testCase.flags & 32768) !== 0,
  });
  const targetFor = (testCase) => ({
    toughness: testCase.toughness,
    save: testCase.save,
    invulnerable: testCase.invulnerable,
    feelNoPain: testCase.feelNoPain,
    wounds: testCase.wounds,
    reduction: 0,
    modelCount: testCase.targetModels,
  });
  const fractionValue = (fraction) => Number(fraction.numerator) / Number(fraction.denominator);

  for (const [index, testCase] of rulesInteractionCases.entries()) {
    const profile = profileFor(testCase);
    const exactResponse = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      }),
      testEnv,
      context,
    );
    const exactText = await exactResponse.text();
    assert.equal(exactResponse.status, 200, `${testCase.name}: ${exactText}`);
    const exact = JSON.parse(exactText).data;
    assert.ok(Math.abs(exact.mean - fractionValue(testCase.expected)) < 1e-12, testCase.name);
    assert.ok(Math.abs(exact.applied.mean - fractionValue(testCase.applied)) < 1e-8, testCase.name);

    const simulationResponse = await worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [profile],
          targets: [targetFor(testCase)],
          seed: (0x51_7c_c1e5 + index * 0x9e_37_79b9) >>> 0,
          trials: 20_000,
        }),
      }),
      testEnv,
      context,
    );
    const simulationText = await simulationResponse.text();
    assert.equal(simulationResponse.status, 200, `${testCase.name}: ${simulationText}`);
    const simulation = JSON.parse(simulationText).data;
    assert.ok(
      Math.abs(simulation.mean - fractionValue(testCase.applied)) < 0.045,
      `${testCase.name}: simulated ${simulation.mean}`,
    );
  }
});

test("reports dependency health, retryable outages, and request diagnostics", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const unavailableEnv = {
    ARMY_DB: {
      prepare() {
        throw new Error("database unavailable");
      },
    },
    ASSETS: {
      async fetch() {
        return new Response("Unavailable", { status: 503 });
      },
    },
  };

  const degraded = await worker.fetch(
    new Request("http://localhost/api/v1/health"),
    unavailableEnv,
    context,
  );
  assert.equal(degraded.status, 503);
  assert.match(degraded.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const degradedBody = await degraded.json();
  assert.equal(degradedBody.status, "degraded");
  assert.deepEqual(
    degradedBody.checks.map((entry) => entry.code),
    ["PROFILE_CATALOGUE_UNAVAILABLE", undefined, "LIST_STORAGE_UNAVAILABLE"],
  );
  assert.equal(degradedBody.checks[1].status, "ok");

  const recovered = await worker.fetch(
    new Request("http://localhost/api/v1/health"),
    testEnv,
    context,
  );
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json();
  assert.equal(recoveredBody.status, "ok");
  assert.deepEqual(
    recoveredBody.checks.map((entry) => entry.name),
    ["profile-catalogue", "calculator-engine", "list-storage"],
  );

  const storageFailure = await worker.fetch(
    new Request("http://localhost/api/v1/lists"),
    unavailableEnv,
    context,
  );
  assert.equal(storageFailure.status, 503);
  assert.deepEqual((await storageFailure.json()).error, {
    message: "Cloud list storage is temporarily unavailable",
    status: 503,
    code: "LIST_STORAGE_UNAVAILABLE",
    retryable: true,
  });
});

test("generated API profiles preserve combat invariants and reject malformed fields", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  let state = 0x9e37_79b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const below = (maximum) => next() % maximum;
  const calculate = async (profile) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      }),
      testEnv,
      context,
    );
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text).data;
  };

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const rerollHits = below(2) === 1;
    const rerollWounds = below(2) === 1;
    const profile = {
      attackDice: 0,
      attackSides: 0,
      attacks: 1 + below(6),
      weaponCount: 1 + below(3),
      hitOn: 2 + below(5),
      strength: 1 + below(16),
      ap: below(4),
      damageDice: 0,
      damageSides: 0,
      damage: 1 + below(5),
      criticalHits: 5 + below(2),
      toughness: 1 + below(16),
      save: 2 + below(6),
      invulnerable: below(3) === 0 ? 0 : 4 + below(3),
      feelNoPain: 0,
      wounds: 1 + below(8),
      targetModels: 1 + below(4),
      reduction: below(3),
      hitModifier: below(5) - 2,
      woundModifier: below(5) - 2,
      lethalHits: below(2) === 1,
      devastatingWounds: below(2) === 1,
      twinLinked: below(2) === 1,
      rerollHits,
      rerollHitOnes: !rerollHits && below(2) === 1,
      rerollWounds,
      rerollWoundOnes: !rerollWounds && below(2) === 1,
    };
    const baseline = await calculate(profile);
    assert.ok(baseline.minimum <= baseline.firstQuartile);
    assert.ok(baseline.firstQuartile <= baseline.median);
    assert.ok(baseline.median <= baseline.thirdQuartile);
    assert.ok(baseline.thirdQuartile <= baseline.maximum);
    assert.ok(baseline.mean >= baseline.minimum && baseline.mean <= baseline.maximum);
    assert.ok(baseline.applied.minimum <= baseline.applied.firstQuartile);
    assert.ok(baseline.applied.firstQuartile <= baseline.applied.median);
    assert.ok(baseline.applied.median <= baseline.applied.thirdQuartile);
    assert.ok(baseline.applied.thirdQuartile <= baseline.applied.maximum);
    assert.ok(baseline.applied.mean <= baseline.mean + 1e-6 * Math.max(1, baseline.mean));

    const betterAp = await calculate({ ...profile, ap: profile.ap + 1 });
    assert.ok(betterAp.mean + 1e-12 >= baseline.mean);
    const withFnp = await calculate({ ...profile, feelNoPain: 5 });
    assert.ok(withFnp.mean <= baseline.mean + 1e-12);
  }

  const target = {
    toughness: 8,
    save: 3,
    invulnerable: 0,
    feelNoPain: 0,
    wounds: 4,
    reduction: 0,
    modelCount: 1,
  };
  const numericKeys = [
    "attacks",
    "weaponCount",
    "hitOn",
    "strength",
    "ap",
    "damage",
    "criticalHits",
    "toughness",
    "save",
    "wounds",
    "targetModels",
    "attackerUnitModels",
    "nearbyEnemyModels",
    "nearbyEnemyUnits",
    "enemyCharacterModelsDestroyed",
    "destructiveFightPhases",
    "embarkedModels",
    "embarkedWracksModels",
    "attackerSourceTargetDistance",
    "targetSourceAttackerDistance",
  ];
  const booleanKeys = [
    "attackerRemainedStationary",
    "attackerAttached",
    "targetAttached",
    "attackerWaaaghActive",
    "targetWaaaghActive",
    "targetOathOfMoment",
    "attackerOathWoundBonusEligible",
    "attackerOnObjective",
    "targetOnObjective",
    "attackerOnAttackerSelectedObjective",
    "targetOnAttackerSelectedObjective",
    "attackerOnTargetSelectedObjective",
    "targetOnTargetSelectedObjective",
    "attackerGuidedAgainstTarget",
    "targetSpotted",
    "targetSpottedByMarkerlightObserver",
    "targetClosestEligible",
    "attackerSourceCanSeeTarget",
    "targetSourceCanSeeAttacker",
    "torrent",
    "blast",
    "heavyActive",
    "targetCover",
    "lethalHits",
    "twinLinked",
  ];
  const invalidNumbers = [-1, 1.5, "3", null, {}, [], 1e20];
  const invalidBooleans = [0, 1, "true", null, {}, []];
  const endpoints = ["/api/v1/calculate", "/api/v1/volley", "/api/v1/volley/simulate"];

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const useBoolean = below(2) === 1;
    const keys = useBoolean ? booleanKeys : numericKeys;
    const values = useBoolean ? invalidBooleans : invalidNumbers;
    const profile = { [keys[below(keys.length)]]: values[below(values.length)] };
    const endpoint = endpoints[below(endpoints.length)];
    const body =
      endpoint === "/api/v1/calculate"
        ? { profile }
        : {
            profiles: [profile],
            targets: [target],
            initialWoundsLost: 0,
            ...(endpoint.endsWith("simulate") ? { seed: 1, trials: 100 } : {}),
          };
    const response = await worker.fetch(
      new Request(`http://localhost${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      testEnv,
      context,
    );
    const result = await response.json();
    assert.equal(response.status, 400, JSON.stringify({ endpoint, body, result }));
    assert.equal(result.error.status, 400);
    assert.equal(result.apiVersion, "v1");
  }
  for (const field of ["attackerObjectiveOwner", "targetObjectiveOwner"]) {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { [field]: "both" } }),
      }),
      testEnv,
      context,
    );
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.match(result.error.message, /unknown, attacker, target, or uncontrolled/i);
  }
  const impossiblePassengers = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { embarkedModels: 5, embarkedWracksModels: 6 } }),
    }),
    testEnv,
    context,
  );
  assert.equal(impossiblePassengers.status, 400);
  assert.match(
    (await impossiblePassengers.json()).error.message,
    /embarkedWracksModels cannot exceed embarkedModels/,
  );
});

test("creates, updates, lists, and deletes durable army lists", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const roster = {
    name: "Test phalanx",
    factionId: "NEC",
    units: [
      {
        id: "unit-1",
        unitId: "datasheet-1",
        name: "Test unit",
        modelCount: 10,
        weapons: [{ weaponId: 7, groupId: "datasheet-1:7", name: "Test weapon", count: 10 }],
        choiceSelections: { "datasheet-1:pool:1": 1 },
        loadoutSubjectCounts: { "datasheet-1:subject:1": 4 },
        combatPresetIds: ["datasheet-1:ability:2"],
      },
    ],
  };
  const createdResponse = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(roster),
    }),
    testEnv,
    context,
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data;
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.units[0].choiceSelections["datasheet-1:pool:1"], 1);
  assert.equal(created.units[0].loadoutSubjectCounts["datasheet-1:subject:1"], 4);
  assert.deepEqual(created.units[0].combatPresetIds, ["datasheet-1:ability:2"]);

  const listed = await worker.fetch(new Request("http://localhost/api/v1/lists"), testEnv, context);
  assert.equal((await listed.json()).data.length, 1);

  const exported = await worker.fetch(
    new Request("http://localhost/api/v1/lists/export"),
    testEnv,
    context,
  );
  const backup = await exported.json();
  assert.equal(backup.kind, "warhammer-calculator-army-lists");
  assert.equal(backup.version, 1);
  assert.equal(typeof backup.profileSourceUpdatedAt, "string");
  assert.equal(backup.lists[0].id, created.id);

  const updated = await worker.fetch(
    new Request(`http://localhost/api/v1/lists/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...roster, name: "Updated phalanx" }),
    }),
    testEnv,
    context,
  );
  assert.equal((await updated.json()).data.name, "Updated phalanx");

  const deleted = await worker.fetch(
    new Request(`http://localhost/api/v1/lists/${created.id}`, { method: "DELETE" }),
    testEnv,
    context,
  );
  assert.equal(deleted.status, 200);

  const imported = await worker.fetch(
    new Request("http://localhost/api/v1/lists/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(backup),
    }),
    testEnv,
    context,
  );
  const importedBody = await imported.json();
  assert.equal(imported.status, 200);
  assert.equal(importedBody.imported, 1);
  assert.equal(importedBody.data[0].id, created.id);

  const incompatible = await worker.fetch(
    new Request("http://localhost/api/v1/lists/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...backup, version: 2 }),
    }),
    testEnv,
    context,
  );
  assert.equal(incompatible.status, 400);
  assert.match((await incompatible.json()).error.message, /unsupported/i);

  const invalid = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...roster,
        units: [
          {
            ...roster.units[0],
            weapons: [{ weaponId: 7, name: "Test weapon", count: 101 }],
          },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error.message, /0 to 100 equipped copies/i);
});

test("rejects Torrent attacks fired indirectly without visibility", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { torrent: true, indirect: true } }),
    }),
    testEnv,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /exceeds|indirect|torrent/i);
});

test("ships the WebAssembly calculator assets", async () => {
  await Promise.all([
    access(new URL("public/wasm/calculator.js", projectRoot)),
    access(new URL("public/wasm/calculator.wasm", projectRoot)),
  ]);

  const workerBundle = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(workerBundle, /import calculatorWasm from ["'].+\.wasm["']/);
  assert.doesNotMatch(workerBundle, /ASSETS\.fetch\(.+calculator\.wasm/s);
});

test("applies Anti only to matching target keywords", () => {
  const abilities = [
    { name: "anti-infantry", value: "3+" },
    { name: "anti-vehicle", value: "4+" },
  ];

  assert.equal(antiWoundThreshold(abilities, ["Infantry", "Character"]), 3);
  assert.equal(antiWoundThreshold(abilities, ["VEHICLE"]), 4);
  assert.equal(antiWoundThreshold(abilities, ["Monster"]), 0);
});

test("catalogue includes target keywords for Anti rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const models = catalogue.units.flatMap((unit) => unit.models);

  assert.ok(models.length > 0);
  assert.ok(models.every((model) => Array.isArray(model.keywords)));
  assert.ok(models.some((model) => model.keywords.includes("vehicle")));
  assert.ok(models.some((model) => model.keywords.includes("infantry")));
});
