"""E2E test data for the AI Diagnosis module.

WHY THIS IS A MODULE AND NOT A FIXTURE FILE

The interesting test cases are all about *which row answers which car*, so the
dataset has to contain rows that deliberately overlap, deliberately conflict,
and deliberately do not apply. A flat "happy path" seed cannot express that.

Every entry below is shaped to exercise one decision the lookup has to make:

  DX-BRK-001  safety-critical, CanDrive.NO      → must never be cached
  DX-BRK-002  same symptom, different maker     → scope must choose correctly
  DX-ENG-001  narrow year band 2015-2018        → must refuse a 2023 car
  DX-ENG-002  odometer band 60k-200k            → must refuse a 12,000 km car
  DX-AC-001   ANY/ANY/ANY, low severity         → the cacheable case
  DX-DTC-001  carries error_code P0301          → DTC must outrank prose
  DX-CVT-001  scoped by engine_code             → specificity ranking
  DX-DRAFT-1  DRAFT / PENDING_REVIEW            → invisible until reviewed
  DX-REJ-001  ACTIVE but PENDING_REVIEW         → one gate is not enough
  DX-AI-001   source_type AI_GENERATED          → approval requires a note

The vehicle data is real: Swift, Nexon, Creta, i20, Ertiga are among the
highest-volume cars in India, and the faults are ones an Indian owner actually
reports. Costs are in rupees and are order-of-magnitude realistic, but they are
test fixtures and must never be copied into the production corpus, which
requires a cited source.
"""

from __future__ import annotations

# ── Master diagnoses ────────────────────────────────────────────────────────
# Field order matches models.diagnosis_kb.DiagnosisMaster.

MASTERS = [
    dict(
        diagnosis_code="DX-BRK-001",
        manufacturer="Maruti Suzuki", model="Swift", fuel_type="Petrol",
        model_year_from=2011, model_year_to=2026,
        system="Brakes", subsystem="Front discs",
        canonical_symptom="BRAKE_GRINDING",
        symptom="Metallic grinding from the front wheels when braking",
        user_keywords="grinding|metal on metal|scraping when braking",
        possible_cause="Front brake pads worn through to the backing plate; the "
                       "steel carrier is now cutting the disc.",
        diagnostic_steps="Look through the wheel spokes at the pad thickness. "
                         "Below 3 mm of friction material, replace. Check the "
                         "disc face for scoring.",
        rule_out="A single squeal on the first brake of a damp morning is surface "
                 "rust and clears within a few stops.",
        severity="CRITICAL", safety_critical=True, can_drive="NO",
        recommended_action="Stop driving. Recover the car to a workshop.",
        requires_professional=True,
        estimated_cost_min=2500, estimated_cost_max=6500,
        source_type="TECHNICAL", source_name="Maruti Suzuki service manual",
        confidence_score=0.95,
    ),
    dict(
        # Same canonical symptom, different manufacturer. Proves scope selection.
        diagnosis_code="DX-BRK-002",
        manufacturer="Hyundai", model="Creta", fuel_type="Diesel",
        model_year_from=2015, model_year_to=2026,
        system="Brakes", subsystem="Rear drums",
        canonical_symptom="BRAKE_GRINDING",
        symptom="Grinding from the rear when braking gently",
        user_keywords="grinding|rear brakes",
        possible_cause="Rear drum shoes worn, or drum surface corroded after "
                       "a monsoon layup.",
        diagnostic_steps="Remove the drum and measure shoe lining thickness.",
        severity="HIGH", safety_critical=True, can_drive="LIMITED",
        recommended_action="Drive only to the nearest workshop, gently.",
        requires_professional=True,
        estimated_cost_min=3000, estimated_cost_max=7000,
        source_type="TECHNICAL", source_name="Hyundai workshop manual",
        confidence_score=0.9,
    ),
    dict(
        # Narrow year band. A 2023 car must NOT get this answer.
        diagnosis_code="DX-ENG-001",
        manufacturer="Tata", model="Nexon", fuel_type="Petrol",
        model_year_from=2015, model_year_to=2018,
        system="Engine", subsystem="Ignition",
        canonical_symptom="ENGINE_MISFIRE",
        symptom="Engine judders under load and the check engine light flashes",
        user_keywords="juddering|jerking|shaking under load|misfire",
        possible_cause="Ignition coil breakdown under load on the early "
                       "1.2 Revotron.",
        diagnostic_steps="Read the DTC. Swap the coil to another cylinder and "
                         "see whether the misfire follows it.",
        severity="HIGH", safety_critical=False, can_drive="LIMITED",
        recommended_action="Book a workshop visit within a day or two.",
        requires_professional=True,
        estimated_cost_min=3500, estimated_cost_max=9000,
        source_type="TECHNICAL", source_name="Tata Motors TSB",
        confidence_score=0.85,
    ),
    dict(
        # Odometer band. A 12,000 km car must NOT get this answer.
        diagnosis_code="DX-ENG-002",
        manufacturer="Hyundai", model="i20", fuel_type="Petrol",
        model_year_from=2014, model_year_to=2026,
        odometer_from_km=60000, odometer_to_km=200000,
        system="Engine", subsystem="Timing",
        canonical_symptom="ENGINE_RATTLE_COLD",
        symptom="Rattle from the engine for two seconds on a cold start",
        user_keywords="rattle on start|noise cold start|chain noise",
        possible_cause="Timing chain tensioner losing pressure overnight — a "
                       "wear item that does not appear on a low-mileage car.",
        diagnostic_steps="Confirm the noise disappears once oil pressure builds. "
                         "Inspect the tensioner.",
        severity="MEDIUM", safety_critical=False, can_drive="YES",
        recommended_action="Have it inspected at the next service.",
        requires_professional=True,
        estimated_cost_min=8000, estimated_cost_max=22000,
        source_type="TECHNICAL", source_name="Hyundai service bulletin",
        confidence_score=0.8,
    ),
    dict(
        # The cacheable case: universal scope, low severity, drivable.
        diagnosis_code="DX-AC-001",
        manufacturer="ANY", model="ANY", fuel_type="ANY",
        model_year_from=2000, model_year_to=2030,
        system="HVAC",
        canonical_symptom="AC_NOT_COOLING",
        symptom="Air conditioning blows air but it is not cold",
        user_keywords="ac not cooling|no cooling|blowing warm air",
        possible_cause="Refrigerant charge low, or the cabin filter is clogged "
                       "after a dusty season.",
        diagnostic_steps="Check the cabin filter first — it is the cheap cause. "
                         "Then gauge the system.",
        severity="LOW", safety_critical=False, can_drive="YES",
        recommended_action="Book an AC service when convenient.",
        requires_professional=True,
        estimated_cost_min=800, estimated_cost_max=4500,
        source_type="TECHNICAL", source_name="Generic HVAC guidance",
        confidence_score=0.7,
    ),
    dict(
        diagnosis_code="DX-DTC-001",
        manufacturer="Tata", model="Nexon", fuel_type="Petrol",
        model_year_from=2015, model_year_to=2026,
        system="Engine", error_code="P0301", related_error_codes="P0300|P0302",
        canonical_symptom="CYL1_MISFIRE",
        symptom="Cylinder 1 misfire detected",
        user_keywords="p0301|cylinder 1 misfire",
        possible_cause="Cylinder 1 ignition or injector fault.",
        diagnostic_steps="Swap the coil and injector to cylinder 2 and re-read "
                         "the code.",
        severity="HIGH", safety_critical=False, can_drive="LIMITED",
        recommended_action="Diagnose before further driving.",
        requires_professional=True,
        source_type="OEM", source_name="OBD-II standard + Tata TSB",
        confidence_score=0.92,
    ),
    dict(
        # Engine-code scoped: should outrank a broader row for the same symptom.
        diagnosis_code="DX-CVT-001",
        manufacturer="Maruti Suzuki", model="Baleno", fuel_type="Petrol",
        engine_code="K12C", transmission="CVT",
        model_year_from=2016, model_year_to=2026,
        system="Transmission",
        canonical_symptom="GEARBOX_SLIP",
        symptom="Revs climb but the car does not accelerate",
        user_keywords="slipping|revving but not moving|cvt slip",
        possible_cause="CVT belt slip from degraded fluid.",
        diagnostic_steps="Check fluid condition and colour; road-test for flare "
                         "on part throttle.",
        severity="HIGH", safety_critical=False, can_drive="LIMITED",
        recommended_action="Stop using the car for highway runs until inspected.",
        requires_professional=True,
        source_type="TECHNICAL", source_name="Suzuki CVT service data",
        confidence_score=0.75,
    ),
    dict(
        # Broader row for the same symptom — must lose to DX-CVT-001 on a Baleno.
        diagnosis_code="DX-GBX-001",
        manufacturer="ANY", model="ANY", fuel_type="ANY",
        model_year_from=2000, model_year_to=2030,
        system="Transmission",
        canonical_symptom="GEARBOX_SLIP",
        symptom="Engine revs rise without matching acceleration",
        user_keywords="slipping|revving but not moving",
        possible_cause="Clutch or transmission slip.",
        diagnostic_steps="Road-test under load.",
        severity="MEDIUM", safety_critical=False, can_drive="LIMITED",
        recommended_action="Have the transmission inspected.",
        requires_professional=True,
        source_type="COMMUNITY", source_name="General guidance",
        confidence_score=0.99,  # deliberately higher — specificity must still win
    ),
]

# Rows that must NOT be servable. Kept separate so a test cannot approve them
# by accident when it seeds the servable set.
UNSERVABLE_MASTERS = [
    dict(
        diagnosis_code="DX-DRAFT-1",
        manufacturer="Maruti Suzuki", model="Ertiga", fuel_type="CNG",
        model_year_from=2018, model_year_to=2026,
        system="Fuel", canonical_symptom="CNG_HARD_START",
        symptom="Hard starting on CNG when cold",
        user_keywords="cng not starting|hard start on gas",
        possible_cause="CNG injector rail pressure low when cold.",
        diagnostic_steps="Start on petrol and switch over once warm.",
        severity="MEDIUM", safety_critical=False, can_drive="LIMITED",
        recommended_action="Have the CNG kit checked.",
        requires_professional=True,
        source_type="TECHNICAL", source_name="Kit installer guidance",
        confidence_score=0.6,
        _status="DRAFT", _verification="PENDING_REVIEW",
    ),
    dict(
        # Published but never reviewed. One gate is not enough.
        diagnosis_code="DX-REJ-001",
        manufacturer="Honda", model="City", fuel_type="Petrol",
        model_year_from=2014, model_year_to=2026,
        system="Electrical", canonical_symptom="BATTERY_DRAIN",
        symptom="Battery flat after two days standing",
        user_keywords="battery drain|car not starting after standing",
        possible_cause="Parasitic draw.",
        diagnostic_steps="Measure quiescent current after the modules sleep.",
        severity="MEDIUM", safety_critical=False, can_drive="LIMITED",
        recommended_action="Have the parasitic draw measured.",
        requires_professional=True,
        source_type="TECHNICAL", source_name="Honda service data",
        confidence_score=0.7,
        _status="ACTIVE", _verification="PENDING_REVIEW",
    ),
    dict(
        # Approving this must require a note saying what it was checked against.
        diagnosis_code="DX-AI-001",
        manufacturer="Kia", model="Seltos", fuel_type="Diesel",
        model_year_from=2019, model_year_to=2026,
        system="Exhaust", canonical_symptom="DPF_WARNING",
        symptom="DPF warning light after repeated short trips",
        user_keywords="dpf light|exhaust warning",
        possible_cause="Diesel particulate filter loaded; regeneration never "
                       "completed on short urban runs.",
        diagnostic_steps="Perform a regeneration drive cycle.",
        severity="MEDIUM", safety_critical=False, can_drive="YES",
        recommended_action="Drive 20 minutes at highway speed to regenerate.",
        requires_professional=False,
        source_type="AI_GENERATED", source_name="Model-generated draft",
        confidence_score=0.5,
        _status="DRAFT", _verification="PENDING_REVIEW",
    ),
]

# ── Solutions ───────────────────────────────────────────────────────────────
# Ordered cheapest and most reversible first, which is the order the lookup
# preserves and the UI renders.

SOLUTIONS = [
    dict(solution_code="DX-BRK-001-S1", diagnosis_code="DX-BRK-001", sequence=1,
         solution_title="Replace front brake pads",
         solution_type="PART_REPLACEMENT", difficulty="MECHANIC",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Raise and support the car\nRemove the caliper\nFit new pads\n"
               "Bed them in over 20 gentle stops",
         cost_parts_min=1800, cost_parts_max=3200,
         cost_labour_min=500, cost_labour_max=900, labour_hours_est=1.5,
         safety_warning="Do not road-test until the pedal is firm.",
         do_not_attempt_if="You cannot support the car on axle stands.",
         success_rate_pct=95),
    dict(solution_code="DX-BRK-001-S2", diagnosis_code="DX-BRK-001", sequence=2,
         solution_title="Skim or replace the front discs",
         solution_type="PART_REPLACEMENT", difficulty="SPECIALIST",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Measure disc thickness against the minimum stamped on the hub\n"
               "Replace in pairs",
         cost_parts_min=3000, cost_parts_max=6000,
         cost_labour_min=800, cost_labour_max=1500, labour_hours_est=2.0),

    dict(solution_code="DX-AC-001-S1", diagnosis_code="DX-AC-001", sequence=1,
         solution_title="Replace the cabin air filter",
         solution_type="PART_REPLACEMENT", difficulty="DIY",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Open the glovebox\nRelease the stops\nSlide the filter out",
         cost_parts_min=350, cost_parts_max=900,
         labour_hours_est=0.3, success_rate_pct=40),
    dict(solution_code="DX-AC-001-S2", diagnosis_code="DX-AC-001", sequence=2,
         solution_title="Regas and leak-test the system",
         solution_type="ADJUSTMENT", difficulty="MECHANIC",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Evacuate\nLeak test with dye\nRecharge to the placard weight",
         cost_parts_min=1500, cost_parts_max=3500,
         cost_labour_min=500, cost_labour_max=1000, labour_hours_est=1.5),

    dict(solution_code="DX-ENG-001-S1", diagnosis_code="DX-ENG-001", sequence=1,
         solution_title="Swap the suspect coil to another cylinder",
         solution_type="INSPECTION_ONLY", difficulty="DIY",
         is_temporary_fix=True, resolves_root_cause=False,
         steps="Unclip coil 1 and coil 2\nSwap them\nClear the code and re-drive",
         labour_hours_est=0.5),
    dict(solution_code="DX-ENG-001-S2", diagnosis_code="DX-ENG-001", sequence=2,
         solution_title="Replace the failed ignition coil",
         solution_type="PART_REPLACEMENT", difficulty="MECHANIC",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Fit a new coil and a matching plug",
         cost_parts_min=2500, cost_parts_max=6000,
         cost_labour_min=500, cost_labour_max=900, labour_hours_est=1.0),
]

# A solution attached to a draft master, to prove a repair cannot be published
# under a finding nobody has verified.
UNSERVABLE_SOLUTIONS = [
    dict(solution_code="DX-AI-001-S1", diagnosis_code="DX-AI-001", sequence=1,
         solution_title="Complete a regeneration drive cycle",
         solution_type="ADJUSTMENT", difficulty="DIY",
         is_temporary_fix=False, resolves_root_cause=True,
         steps="Drive at a steady 80 km/h for 20 minutes",
         _status="DRAFT", _verification="PENDING_REVIEW"),
]

# ── Aliases ─────────────────────────────────────────────────────────────────
# How Indian drivers actually phrase these, including Hinglish, which is the
# realistic input and the reason a keyword matcher was never going to be enough.

ALIASES = [
    ("BRAKE_GRINDING", "grinding when i brake"),
    ("BRAKE_GRINDING", "brake se awaaz aa rahi hai"),
    ("BRAKE_GRINDING", "metal sound while braking"),
    ("ENGINE_MISFIRE", "car juddering"),
    ("ENGINE_MISFIRE", "engine jerking while driving"),
    ("ENGINE_MISFIRE", "gaadi jhatke maar rahi hai"),
    ("ENGINE_RATTLE_COLD", "rattling noise on cold start"),
    ("AC_NOT_COOLING", "ac not cooling"),
    ("AC_NOT_COOLING", "ac se thandi hawa nahi aa rahi"),
    ("GEARBOX_SLIP", "revving but not moving"),
    ("CNG_HARD_START", "cng not starting"),
    ("BATTERY_DRAIN", "battery drain"),
    ("DPF_WARNING", "dpf light on"),
    # A deliberately short alias, to prove word-boundary matching:
    # must not fire inside "acceleration".
    ("AC_NOT_COOLING", "ac"),
]

# ── Request payloads ────────────────────────────────────────────────────────
# Valid against routers.diagnosis.DiagnoseRequest — fuel_type, transmission and
# severity are all regex-constrained, and getting one wrong is a 422 rather
# than a diagnosis.

def request(**over) -> dict:
    """A valid /diagnosis/analyse body, overridable per case."""
    body = dict(
        manufacturer="Maruti Suzuki",
        model="Swift",
        variant="VXi",
        model_year=2019,
        fuel_type="Petrol",
        transmission="Manual",
        odometer_km=62000,
        problem_description="There is a grinding when I brake at low speed",
        warning_lights=[],
        when_occurs=["When braking"],
        severity="high",
    )
    body.update(over)
    return body
