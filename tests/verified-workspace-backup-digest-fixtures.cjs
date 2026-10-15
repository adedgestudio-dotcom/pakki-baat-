const fixtures = {
  nested: {
    owner: "Āsha", business: "Cake & Co",
    jobs: [{ id: "job-1", customer: "Zoë", work: "Cake & tea", total: 1250.5, paid: 250, date: "2026-10-11", time: "09:30", status: "Confirmed", source: "WhatsApp", createdAt: "2026-10-11T09:00:00Z" }],
    payments: [{ id: "pay-1", customer: "Zoë", jobId: "job-1", amount: 250, date: "2026-10-11", note: "Paid ₹250", createdAt: "2026-10-11T09:31:00Z" }],
    reminders: [{ id: "rem-1", text: "Call \"Zoë\"\n", date: "2026-10-12", time: "10:00", customer: "Zoë", jobId: "job-1", repeat: "weekly", done: false, createdAt: "2026-10-11T09:32:00Z" }],
    notes: [{ id: "note-1", customer: "Zoë", text: "Unicode: café ✓", createdAt: "2026-10-11T09:33:00Z" }],
    customerPhones: { "Åsha": "919999999999", "李": "8613800000000" },
  },
  key_ordering: { owner: "O", business: "B", jobs: [], payments: [], reminders: [], notes: [], customerPhones: { bbb: "1", a: "2", "Å": "3", "é": "4", aa: "5" } },
  numeric_decimal: { owner: "N", business: "B", jobs: [{ id: "n", customer: "C", work: "W", total: 0.000001, paid: 0, date: "2026-10-11", time: "", status: "Waiting", source: "S" }], payments: [], reminders: [], notes: [], customerPhones: {} },
  escaping: { owner: "Line\nTab\tQuote\"Slash\\", business: "<>&", jobs: [], payments: [], reminders: [], notes: [], customerPhones: { "x/y": "\b\f\r" } },
};
const jsonbEdges = {
  null_boolean_array: { z: null, a: [true, false, null, { bb: "x", a: "y" }] },
};
module.exports = { fixtures, jsonbEdges };
