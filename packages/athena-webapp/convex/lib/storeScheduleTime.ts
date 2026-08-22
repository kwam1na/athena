/**
 * Implementation lives in `shared/storeScheduleTime` so the Store Hours UI can
 * share the reporting-cycle boundary calculation with the schedule mutation
 * without importing a Convex module. Convex code keeps importing the schedule
 * math from here.
 */
export * from "../../shared/storeScheduleTime";
