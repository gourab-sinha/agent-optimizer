/**
 * Job queue stub - referenced by graceful shutdown.
 * Extend with real queue workers as needed.
 */
export async function stopQueue() {
  return true;
}

export default { stopQueue };
