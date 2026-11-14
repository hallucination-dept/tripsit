// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: {
				id: string;
				name: string;
				email: string;
			};
			session?: {
				id: string;
				userId: string;
			};
		}
	}
}

export {};
