/* Herd · sample data
   Fourteen authored days per subject, ending yesterday, so today's entry form
   starts empty. Values are written by hand (not random) so each record tells a
   coherent story: a stable baseline with one or two genuine off days. */
(function (H) {
  'use strict';

  // [daysAgo, wake, intake, energy, activityMin, behavior, anomaly]
  const DOG_1 = [
    [14, '06:35', 'full', 4, 70, 'Two walks, normal gait. Settled by 21:00.', ''],
    [13, '06:30', 'full', 3, 60, 'Brushed out undercoat. Calm; long afternoon nap.', ''],
    [12, '06:40', 'full', 4, 75, 'Trail walk, 3.1 km. Kept pace throughout.', ''],
    [11, '06:25', 'full', 3, 66, 'Greeted visitors calmly. Normal water intake.', ''],
    [10, '06:45', 'full', 3, 58, 'Warm afternoon; sought shade, shorter second walk.', ''],
    [9, '06:30', 'full', 4, 72, 'Two fetch sessions in the yard.', ''],
    [8, '06:35', 'full', 3, 64, 'Routine day.', ''],
    [7, '06:50', 'partial', 4, 62, 'Slow to finish breakfast; ate dinner fully.', ''],
    [6, '06:30', 'full', 4, 70, 'Appetite back to normal.', ''],
    [5, '06:40', 'full', 3, 64, 'Calm. Normal stool.', ''],
    [4, '06:30', 'full', 3, 60, 'Rain; indoor play instead of second walk.', ''],
    [3, '07:25', 'low', 2, 28, 'Reluctant on walk, turned back at 10 min. Lay on cool tile most of the day.', 'Ate ~25% of meals. Slight front-left limp after rest.'],
    [2, '07:05', 'partial', 3, 46, 'Improving. Finished dinner.', 'Limp resolved by evening.'],
    [1, '06:40', 'full', 4, 58, 'Near normal. Two shorter walks as a precaution.', ''],
  ];

  const DOG_2 = [
    [14, '06:05', 'full', 5, 110, 'Off-leash park, 40 min. High engagement.', ''],
    [13, '06:00', 'full', 4, 95, 'Recall and stay drills, 2 × 15 min.', ''],
    [12, '05:55', 'full', 5, 120, 'Run and fetch. Recovered quickly.', ''],
    [11, '06:10', 'full', 4, 92, 'Groomer visit; rested in the afternoon.', ''],
    [10, '06:15', 'low', 3, 68, 'Ignored new kibble; accepted treats only.', 'Food transition day 1. Refused ~70% of meals.'],
    [9, '06:05', 'partial', 4, 94, 'Old and new food mixed 50/50; ate most of it.', ''],
    [8, '06:00', 'full', 5, 105, 'Good appetite on the blend.', ''],
    [7, '06:00', 'full', 4, 100, 'Routine day.', ''],
    [6, '05:50', 'full', 5, 115, 'Agility class. Clean runs.', ''],
    [5, '06:05', 'full', 4, 98, 'Calm evening.', ''],
    [4, '06:00', 'full', 5, 108, 'Long park session.', ''],
    [3, '06:10', 'full', 4, 96, 'Routine day.', ''],
    [2, '06:00', 'full', 5, 104, 'Training refresher; focused.', ''],
    [1, '07:10', 'partial', 2, 48, 'Lethargic; declined second walk. Drinking normally.', 'Soft stool AM. Recheck appetite tonight; call vet if no improvement in 24 h.'],
  ];

  H.seed = function seed(today) {
    const U = H.util;
    const createdAt = new Date().toISOString();

    const subjects = [
      {
        id: 'HRD-0001', name: 'Dog 1', species: 'Dog', breed: 'Bernese mountain dog',
        sex: 'MN', ageYears: 5, ageRecordedOn: today, createdAt,
      },
      {
        id: 'HRD-0002', name: 'Dog 2', species: 'Dog', breed: 'Poodle (standard)',
        sex: 'FS', ageYears: 3, ageRecordedOn: today, createdAt,
      },
    ];

    const entries = [];
    const add = (subjectId, rows) => rows.forEach(([ago, wake, intake, energy, activity, behavior, anomaly]) => {
      entries.push({
        id: U.uid('e'), subjectId, date: U.addDays(today, -ago),
        wake, intake, energy, activity, behavior, anomaly,
      });
    });
    add('HRD-0001', DOG_1);
    add('HRD-0002', DOG_2);

    return {
      version: 1,
      meta: { nextSeq: 3, lastExportAt: null, seededOn: today },
      subjects,
      entries,
    };
  };
})(window.Herd = window.Herd || {});
