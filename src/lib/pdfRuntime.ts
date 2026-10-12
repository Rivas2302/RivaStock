/** PDF tooling is optional; never download it while opening a normal page. */
export async function loadPdfRuntime() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}
