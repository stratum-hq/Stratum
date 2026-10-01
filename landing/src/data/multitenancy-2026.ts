/**
 * Chart series for the post "The State of Multi-Tenancy in Node.js, Fall 2026".
 *
 * Each series has 12 values, October to September. `prior` is Oct 2024 to
 * Sep 2025, `current` is Oct 2025 to Sep 2026. The numbers are copied from the
 * published data in public/data/multitenancy-2026/:
 *
 * - newCorePackages: monthly_new_packages.csv, prev_core_pkgs / cur_core_pkgs.
 * - newDedicatedProjects: monthly_new_packages.csv, prev_name_tenant_projects /
 *   cur_name_tenant_projects.
 * - coreDownloads: downloads_monthly_summary.csv `excl_payload`, minus the
 *   @sap/cds-mtxs series in downloads_monthly_core.json.
 */

export const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

export const priorLabel = 'Oct 2024 to Sep 2025';
export const currentLabel = 'Oct 2025 to Sep 2026';

export const newCorePackages = {
  prior: [4, 0, 6, 6, 3, 4, 8, 32, 26, 20, 21, 24],
  current: [42, 57, 60, 47, 90, 131, 123, 127, 122, 189, 137, 156],
};

export const newDedicatedProjects = {
  prior: [1, 0, 2, 2, 1, 3, 4, 11, 5, 4, 4, 5],
  current: [4, 6, 7, 8, 11, 12, 9, 10, 17, 15, 19, 14],
};

export const coreDownloads = {
  prior: [47041, 52589, 51500, 65302, 50197, 63722, 62090, 56112, 66990, 67114, 66067, 77169],
  current: [
    118808, 86511, 149864, 139735, 202243, 270913, 269130, 389504, 798727, 1113914, 1290918, 1106948,
  ],
};
