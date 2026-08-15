"""
A labelled set for calibrating the semantic-match threshold.

`MIN_SEMANTIC_SIMILARITY` was 0.62 because 0.62 felt conservative. That is a
judgement, and a judgement about a number that decides whether a driver is
shown a diagnosis or not deserves to be a measurement.

This file is the measurement's input: symptom descriptions in the words a
driver would actually use, each labelled with the knowledge-base row that
*should* answer it — or `None`, meaning **nothing in this corpus explains it
and the correct behaviour is to fall through to a model**.

THE NEGATIVES ARE THE POINT

A threshold tuned only on positives goes to zero: match everything, recall is
perfect. The cost of that is invisible until a driver with a clutch problem is
told about their brakes, with a source and a cost estimate attached, because a
sentence about one system scored 0.4 against a row about another.

So the negatives here are not random text. They are the near misses — same
vehicle, adjacent system, similar vocabulary — because those are the ones a
cosine score gets wrong. "a burning plastic smell from the dashboard wiring"
shares its strongest word with the clutch row's burning smell, and "the fuel
gauge reads empty" is about an instrument the overheating row also mentions.
Those are the hard rejects, and they are the ones worth having.

WHY PRECISION IS WEIGHTED ABOVE RECALL

Missing a match costs a model call. Making a wrong one costs a driver a wrong
answer wearing the authority of a curated source. Those are not symmetric, and
the calibration in `scripts/tune_semantic_threshold.py` does not treat them as
though they are.
"""

# Knowledge-base rows: (code, canonical_symptom, symptom, user_keywords,
# possible_cause). The last three are exactly the fields
# `diagnosis_kb_lookup._master_text` concatenates to embed a row — a
# calibration that embedded a different blob than the lookup does would be
# measuring something the product never runs.
CORPUS: list[tuple[str, str, str, str, str]] = [
    (
        "DX-BRK-001",
        "brake_squeal",
        "High-pitched squealing or screeching noise when the brake pedal is pressed, "
        "usually worse at low speed and when the brakes are cold.",
        "squeal, screech, squeak, brake noise, whistling when braking",
        "Brake pad friction material worn to the wear indicator, or glazed pads.",
    ),
    (
        "DX-BRK-002",
        "brake_judder",
        "Steering wheel or brake pedal pulses and shudders under braking, "
        "most noticeable when slowing from highway speed.",
        "juddering, shuddering, vibration when braking, pulsing pedal, wobble",
        "Warped front brake discs, or uneven pad deposits on the disc face.",
    ),
    (
        "DX-ENG-001",
        "engine_misfire",
        "Engine stumbles, shakes at idle and hesitates under acceleration; "
        "the check engine light may flash.",
        "misfire, stumbling, jerking, rough idle, hesitation, shaking engine",
        "Failing ignition coil or spark plug on one cylinder, or a clogged injector.",
    ),
    (
        "DX-ENG-002",
        "engine_overheat",
        "Temperature gauge climbs into the red, steam or a sweet smell from the bonnet, "
        "coolant level dropping.",
        "overheating, temperature warning, steam, boiling, coolant loss",
        "Coolant leak, failed thermostat, or a radiator fan that is not cutting in.",
    ),
    (
        "DX-CLU-001",
        "clutch_slip",
        "Engine revs rise without matching acceleration, especially in higher gears "
        "or on an incline; a burning smell after hill starts.",
        "clutch slipping, revs but no pull, burning smell, loss of power uphill",
        "Worn clutch friction plate, or a clutch cable or hydraulic line out of adjustment.",
    ),
    (
        "DX-SUS-001",
        "suspension_knock",
        "Knocking or clunking from the front suspension over speed breakers and "
        "potholes, with vague steering.",
        "knocking, clunking, rattle over bumps, thud, loose steering",
        "Worn suspension strut mounts, anti-roll bar links, or ball joints.",
    ),
    (
        "DX-BAT-001",
        "battery_weak",
        "Engine cranks slowly or not at all, headlights dim when starting, "
        "worse after the car has stood overnight.",
        "slow cranking, not starting, dim lights, dead battery, clicking on start",
        "Battery at end of life, a failing alternator, or corroded terminals.",
    ),
    (
        "DX-STE-001",
        "steering_pull",
        "Car pulls to one side on a straight road and the tyres wear unevenly.",
        "pulling to one side, drifting, uneven tyre wear, misaligned",
        "Wheel alignment out of specification, or uneven tyre pressures.",
    ),
]

# (driver's words, the code that should answer it, or None to fall through)
LABELLED: list[tuple[str, str | None]] = [
    # ── Should match: paraphrases, the case keyword lookup misses ────────────
    ("there is a loud screeching sound whenever I slow down", "DX-BRK-001"),
    ("my brakes make a horrible high pitched noise in the morning", "DX-BRK-001"),
    ("the steering wheel shakes badly when I brake from high speed", "DX-BRK-002"),
    ("pedal vibrates under my foot when stopping on the highway", "DX-BRK-002"),
    ("engine feels rough and jerks when I press the accelerator", "DX-ENG-001"),
    ("car shudders at traffic lights and the engine light is blinking", "DX-ENG-001"),
    ("temperature needle going to red and there is steam", "DX-ENG-002"),
    ("coolant keeps reducing and the bonnet smells sweet", "DX-ENG-002"),
    ("rpm goes up but the car does not pick up speed on a slope", "DX-CLU-001"),
    ("burning smell after climbing a hill and poor pickup", "DX-CLU-001"),
    ("clunking sound from the front when going over speed breakers", "DX-SUS-001"),
    ("rattling noise over potholes and the steering feels loose", "DX-SUS-001"),
    ("car does not start in the morning, just clicks", "DX-BAT-001"),
    ("headlights go dim when I turn the key and cranking is slow", "DX-BAT-001"),
    ("vehicle drifts to the left on a straight road", "DX-STE-001"),
    ("tyres wearing out on one edge and the car pulls sideways", "DX-STE-001"),

    # ── Should NOT match: the corpus does not explain these ──────────────────
    # Near misses by design — same vocabulary, different system.
    ("the air conditioning is not cooling properly", None),
    ("there is a burning plastic smell from the dashboard wiring", None),
    ("my music system keeps restarting on its own", None),
    ("the boot lid will not stay open", None),
    ("windscreen washer is not spraying any water", None),
    ("the fuel gauge reads empty even after filling the tank", None),
    ("door lock does not respond to the remote key", None),
    ("seat belt is stuck and will not pull out", None),
]

__all__ = ["CORPUS", "LABELLED"]
