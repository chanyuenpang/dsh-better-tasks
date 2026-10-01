window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-user-questions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/region-boundary.tsx
		/**
		* Contain one region's render failure at this package's own registration.
		*
		* The framework's `SlotErrorBoundary` wraps the whole occupancy, so any throw in a
		* region retired that entry and blanked the area. This boundary sits directly
		* around the component this package registers, records the failure — including
		* `info.componentStack`, which names the offending descendant — and renders a
		* compact fallback instead of rethrowing, so the rest of the shell stays usable
		* while the real adaptation is written.
		*/
		/** Stamped at build time by scripts/build-forks-from-source.mjs. */
		const BUILD_REVISION = "2887aaa1b13970f5cd011b907e9d311ee0efd9591080918c29a6f62c1f8048ea";
		function withRegionBoundary(region, Inner) {
			return class RegionBoundary extends react.Component {
				state = { failed: false };
				static getDerivedStateFromError() {
					return { failed: true };
				}
				componentDidCatch(error, info) {
					try {
						localStorage.setItem(`dbt-region-error:${region}`, JSON.stringify({
							revision: BUILD_REVISION,
							region,
							message: String(error?.message ?? error),
							stack: String(error?.stack ?? "").slice(0, 2e3),
							componentStack: String(info?.componentStack ?? "").slice(0, 2e3)
						}));
					} catch {}
				}
				render() {
					if (this.state.failed) return (0, react.createElement)("div", { style: {
						padding: "8px",
						font: "11px ui-monospace, monospace",
						color: "#ff9f9f"
					} }, `${region}: render failed`);
					return (0, react.createElement)(Inner, this.props);
				}
			};
		}
		//#endregion
		//#region C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/util/brand/src/index.ts
		/**
		* Apply a compile-time string brand without changing the value.
		* @param value - string admitted by the domain that owns the target brand.
		* @returns the same string with the requested compile-time brand.
		*/
		function brandString(value) {
			return value;
		}
		//#endregion
		//#region src/client/contract/slots.ts
		function settlePendingComposer(settle, failureMessage) {
			try {
				settle();
				return Promise.resolve();
			} catch (error) {
				return Promise.reject(error instanceof Error ? error : new Error(failureMessage, { cause: error }));
			}
		}
		/**
		* Narrow a request to a renderable plan review, or return undefined to leave it
		* to the generic question flow.
		*
		* The card offers approval and a return to the composer for change requests.
		* It accepts one question carrying the plan as detail and the named approve
		* option, with at most one alternative and no multi-select. Larger choices
		* remain in the generic question flow.
		*
		* @param questions - the request's whole question batch.
		* @returns The narrowed review, or undefined when the generic flow owns it.
		*/
		function planReviewOf(questions) {
			if (questions.length !== 1) return void 0;
			const question = questions[0];
			const intent = question.intent;
			if (intent?.kind !== "plan-review" || question.detail === void 0) return void 0;
			if (question.multiSelect === true) return void 0;
			const options = question.options ?? [];
			if (options.length > 2) return void 0;
			const approve = options.find((option) => option.label === intent.approve);
			if (approve === void 0) return void 0;
			const decline = options.find((option) => option.label !== intent.approve);
			return {
				id: question.id,
				question: question.question,
				plan: question.detail,
				...intent.callId === void 0 ? {} : { callId: intent.callId },
				approve,
				...decline === void 0 ? {} : { decline }
			};
		}
		/** Reload-unique prefix so an unnamed legacy card cannot reuse a persisted draft. */
		const unnamedQuestionPrefix = Array.from(globalThis.crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
		let nextQuestionKey = 0;
		const rejectionMessages = {
			ASK_ABORTED: "ask_user_question was aborted before the user answered",
			ASK_CANCELLED: "the user cancelled ask_user_question",
			ASK_TIMED_OUT: "ask_user_question timed out before the user answered"
		};
		/** Create a wire-preserved user-question rejection. */
		function questionError(code) {
			const error = new Error(rejectionMessages[code]);
			error.name = "UserQuestionError";
			error.code = code;
			return error;
		}
		/**
		* Create the deferred one Remote Event listener settles through a card.
		* The request signal ends the channel with `ASK_ABORTED`; the Host ignores that
		* outcome for an event it already finished, so a cancel frame loses nothing.
		* @param deadline - Client-clock deadline in epoch milliseconds derived from the business claim's remaining duration.
		* @param signal - Delivery lifetime of the forwarded request.
		* @param onSettle - Called once with the channel when it settles or aborts.
		* @returns The channel to attach and the promise the listener awaits.
		*/
		function createWaterfallRequest(deadline, signal, onSettle) {
			const completion = Promise.withResolvers();
			const delegated = Symbol("pending question delegated");
			let settled = false;
			const finish = (settle) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				settle();
				onSettle(channel);
			};
			const onAbort = () => {
				finish(() => {
					completion.reject(questionError("ASK_ABORTED"));
				});
			};
			const channel = {
				deadline,
				resolve: (answer) => {
					finish(() => {
						completion.resolve(answer);
					});
				},
				reject: (code) => {
					finish(() => {
						completion.reject(questionError(code));
					});
				},
				delegate: () => {
					finish(() => {
						completion.reject(delegated);
					});
				}
			};
			if (signal !== void 0) {
				signal.addEventListener("abort", onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			return {
				channel,
				result: completion.promise,
				isDelegation: (reason) => reason === delegated
			};
		}
		/**
		* One answerable Client card. A card keyed by tool call is created by whichever
		* source arrives first, the forwarded waterfall or the Session projection, and
		* removed only when the projection no longer lists the call.
		*/
		var PendingQuestion = class PendingQuestion {
			/** Presentation discriminator used by Session pending-interaction consumers. */
			kind;
			/** Render identity and request key for the Session-scoped draft store. */
			key;
			/** Agent/Session identity owning the request. */
			sessionId;
			/** The request's question list. */
			questions;
			/** Tool call identity; absent for a blocking request that carried no `wait`. */
			callId;
			/**
			* Recorded answers of a call that already settled. Present only on a
			* read-only review card, which the tool call row builds from its own
			* transcript so a finished question can be read back in the panel that
			* asked it. Such a card has no answer channel and no countdown.
			*/
			review;
			/**
			* What closing the panel does. A card keyed by tool call stays reachable
			* from its tool call row, so closing only withdraws the panel (`hide`) and
			* persists nothing. A card the Host never named has no way back, so closing
			* it ends the request (`cancel`).
			*/
			dismissal;
			#state = "open";
			#waterfall;
			#rpc;
			#seat;
			#timedWait = false;
			#timer;
			#deadline;
			#remainingMs;
			#focused = false;
			#focusOwners = /* @__PURE__ */ new Set();
			#defaultFocusOwner = {};
			#engaged = false;
			#held = false;
			#closed = false;
			#siblings;
			#listeners = /* @__PURE__ */ new Set();
			#snapshot;
			/**
			* @param sessionId - Agent/Session identity owning the request.
			* @param questions - complete question batch.
			* @param callId - tool call identity when the Host named one.
			* @param siblings - keys of every card currently registered for the Session, for draft pruning.
			* @param review - recorded answers of a settled call, making this a read-only card.
			*/
			constructor(sessionId, questions, callId, siblings, review) {
				this.sessionId = sessionId;
				this.questions = questions;
				this.kind = planReviewOf(questions) === void 0 ? "question" : "plan-review";
				this.callId = callId;
				this.review = review;
				this.dismissal = callId === void 0 ? "cancel" : "hide";
				this.#siblings = siblings;
				if (callId === void 0) nextQuestionKey += 1;
				this.key = callId === void 0 ? `question:${unnamedQuestionPrefix}:${String(nextQuestionKey)}` : PendingQuestion.keyOf(sessionId, callId);
				this.#snapshot = this.createSnapshot();
			}
			/**
			* Card key of a tool call, shared by every source that names one. The Host
			* request and the Session projection carry the branded `ToolCallId`; a
			* transcript row carries the same wire value as a plain string.
			* @param sessionId - owning Session.
			* @param callId - tool call identity, branded or as a transcript spells it.
			* @returns the render identity and draft key.
			*/
			static keyOf(sessionId, callId) {
				return `question:${String(sessionId)}:${callId}`;
			}
			/**
			* Draft keys that are still live in this Session, this card included.
			* @returns keys the draft store must keep; everything else is stale.
			*/
			liveKeys() {
				return this.#siblings?.() ?? [this.key];
			}
			/** Subscribe to card state changes. */
			subscribe = (listener) => {
				this.#listeners.add(listener);
				return () => {
					this.#listeners.delete(listener);
				};
			};
			/** Read the stable current card state. */
			snapshot = () => this.#snapshot;
			/** Observable snapshot read by the renderer's keyed Hook. */
			getSnapshot = this.snapshot;
			createSnapshot() {
				const channel = this.#waterfall !== void 0 ? "waterfall" : this.#state === "continued" && this.#rpc !== void 0 ? "rpc" : "none";
				const waitState = this.#state === "continued" ? "continued" : this.#held ? "waiting" : this.#engaged ? "editing" : this.#focused ? "focused" : "counting";
				return {
					state: this.#state,
					waitState,
					countdown: this.#timedWait ? {
						remainingMs: this.#deadline === void 0 ? this.#remainingMs ?? 0 : Math.max(0, this.#deadline - Date.now()),
						running: this.#deadline !== void 0
					} : void 0,
					channel,
					closed: this.#closed
				};
			}
			publish() {
				this.#snapshot = this.createSnapshot();
				this.#reschedule();
				for (const listener of this.#listeners) listener();
			}
			/**
			* Own the countdown here rather than in a mounted component: the panel can be
			* hidden and remounted while the request stands, and a timer that died with
			* the component would leave the tool call waiting past its deadline.
			*/
			#reschedule() {
				const wanted = this.#deadline !== void 0 && !this.#closed;
				if (wanted === (this.#timer !== void 0)) return;
				if (!wanted) {
					clearInterval(this.#timer);
					this.#timer = void 0;
					return;
				}
				this.#timer = setInterval(() => {
					this.#tick();
				}, 1e3);
			}
			#tick() {
				const deadline = this.#deadline;
				/* v8 ignore next -- #reschedule clears the interval in the same publish that drops the deadline. */
				if (deadline === void 0) return;
				if (Date.now() >= deadline) {
					this.timeout();
					return;
				}
				this.publish();
			}
			/**
			* Attach the live waterfall of a forwarded request.
			* @param channel - request channel created by {@link createWaterfallRequest}.
			*/
			attachWaterfall(channel) {
				this.#waterfall = channel;
				this.#timedWait = channel.deadline !== void 0;
				if (!this.#held && !this.#engaged) {
					this.#deadline = channel.deadline;
					if (this.#focused && channel.deadline !== void 0) {
						this.#remainingMs = Math.max(0, channel.deadline - Date.now());
						this.#deadline = void 0;
					}
				}
				this.publish();
			}
			/**
			* Drop a waterfall channel that settled or was cancelled; the card stays.
			* @param channel - the channel that ended.
			*/
			detachWaterfall(channel) {
				if (this.#waterfall !== channel) return;
				this.#waterfall = void 0;
				this.#timedWait = false;
				this.#deadline = void 0;
				this.publish();
			}
			/**
			* Whether a live waterfall is attached.
			* @returns whether the pending Host request still accepts settlement.
			*/
			hasWaterfall() {
				return this.#waterfall !== void 0;
			}
			/**
			* Attach the Remote answer path used once the question is continued.
			* @param channel - Remote calls bound to this Session and call.
			*/
			attachRpc(channel) {
				this.#rpc = channel;
				this.publish();
			}
			/**
			* Attach the composer seat this card is published into.
			* @param seat - withdrawal of the published panel, owned by the card registry.
			*/
			attachSeat(seat) {
				this.#seat = seat;
			}
			/**
			* Copy the projection row state.
			* @param state - `open` or `continued`.
			*/
			setState(state) {
				if (this.#state === state) return;
				this.#state = state;
				this.publish();
			}
			/** Stop this Client's countdown indefinitely; the waterfall then waits like a blocking question. */
			takeTime() {
				if (this.#held) return;
				this.#held = true;
				this.#focusOwners.clear();
				this.#focused = false;
				this.#remainingMs = void 0;
				this.#deadline = void 0;
				this.publish();
			}
			/**
			* Record focus even before the request arrives, freezing a pristine countdown once attached.
			* @param now - current Client epoch time.
			*/
			holdFocus(now = Date.now(), owner = this.#defaultFocusOwner) {
				if (this.#closed || this.#held || this.#engaged || this.#focusOwners.has(owner)) return;
				this.#focusOwners.add(owner);
				if (this.#focused) return;
				this.#remainingMs = this.#deadline === void 0 ? void 0 : Math.max(0, this.#deadline - now);
				this.#deadline = void 0;
				this.#focused = true;
				this.publish();
			}
			/**
			* Resume a pristine countdown after the answer surface loses focus.
			* @param now - current Client epoch time.
			*/
			releaseFocus(now = Date.now(), owner = this.#defaultFocusOwner) {
				if (!this.#focusOwners.delete(owner) || this.#focusOwners.size > 0 || !this.#focused) return;
				this.#focused = false;
				this.#deadline = this.#timedWait && this.#remainingMs !== void 0 ? now + this.#remainingMs : void 0;
				this.#remainingMs = void 0;
				this.publish();
			}
			/**
			* Keep the first edited draft answerable without a foreground deadline.
			* @param now - current Client epoch time used to preserve the remaining duration.
			*/
			engage(now = Date.now()) {
				if (this.#held || this.#engaged) return;
				if (this.#remainingMs === void 0 && this.#deadline !== void 0) this.#remainingMs = Math.max(0, this.#deadline - now);
				this.#engaged = true;
				this.#focusOwners.clear();
				this.#focused = false;
				this.#deadline = void 0;
				this.publish();
			}
			/** Local countdown reached zero: settle the waterfall with `ASK_TIMED_OUT`, keep the card. */
			timeout() {
				if (this.#held || this.#engaged || this.#focused) return;
				const channel = this.#waterfall;
				if (channel === void 0) return;
				this.#waterfall = void 0;
				this.#timedWait = false;
				this.#deadline = void 0;
				channel.reject("ASK_TIMED_OUT");
				this.publish();
			}
			/** Hand a live waterfall to the next listener when this presentation domain unloads. */
			delegate() {
				this.#waterfall?.delegate();
			}
			/** Mark the card removed from the registry; the mounted composer clears its draft. */
			close() {
				if (this.#closed) return;
				this.#closed = true;
				this.#focusOwners.clear();
				this.#focused = false;
				this.publish();
			}
			/**
			* Submit the whole answer batch through the live waterfall, or through the
			* Remote path once the question is continued.
			* @param answer - complete structured answer batch.
			*/
			answer(answer) {
				const waterfall = this.#waterfall;
				if (waterfall !== void 0) return settlePendingComposer(() => {
					waterfall.resolve(answer);
				}, "pending question settlement failed");
				const rpc = this.#rpc;
				if (this.#state === "continued" && rpc !== void 0) return rpc.answer(answer).then((accepted) => {
					if (!accepted) throw new Error("this question is no longer answerable");
				});
				return Promise.reject(/* @__PURE__ */ new Error("no channel accepts an answer yet"));
			}
			/**
			* Close the panel. A tool-call-keyed card only leaves the composer seat: the
			* request stands, the countdown keeps running here, and the tool call row
			* reopens it. A card the Host never named ends its request instead, because
			* nothing could bring it back.
			*/
			dismiss() {
				if (this.dismissal === "hide") return settlePendingComposer(() => {
					this.#seat?.hide();
				}, "pending question hide failed");
				const waterfall = this.#waterfall;
				if (waterfall === void 0) return Promise.reject(/* @__PURE__ */ new Error("no channel accepts a cancellation yet"));
				return settlePendingComposer(() => {
					waterfall.reject("ASK_CANCELLED");
				}, "pending question cancellation failed");
			}
		};
		//#endregion
		//#region ../../../node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:G:\Projects\dsh-better-tasks\.srcbuild\packages\client\ui-user-questions\src\client\PlanReviewPanel.module.css.mjs
		const css$2 = ".vMLJPa_frame{padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px;justify-content:center;display:flex}.vMLJPa_card{width:100%;max-width:var(--dsh-chat-content-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);border:0;flex-direction:column;display:flex;overflow:hidden}.vMLJPa_card,.vMLJPa_card *{box-sizing:border-box}.vMLJPa_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);flex-shrink:0;align-items:center;gap:8px;padding:12px 16px;font-size:14px;line-height:20px;display:flex}.vMLJPa_footer{flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px 12px;display:flex}.vMLJPa_feedback{min-height:16px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}.vMLJPa_actions{flex-shrink:0;align-items:center;gap:8px;display:flex}.vMLJPa_summary{min-width:0;padding:14px 16px 12px}.vMLJPa_title{text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:15px;font-weight:500;line-height:22px;overflow:hidden}.vMLJPa_description{-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);-webkit-box-orient:vertical;margin:8px 0 0;font-size:14px;line-height:24px;display:-webkit-box;overflow:hidden}.vMLJPa_discuss{gap:6px}@media (width<=720px){.vMLJPa_card{border-radius:var(--dsw-radius-xl)}.vMLJPa_footer{align-items:flex-end;padding:8px 12px 10px}}.vMLJPa_previewActions{align-items:center;margin-left:auto;display:flex}";
		const tagId$2 = "@deepseek-ai/dsh-client-ui-user-questions/PlanReviewPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-user-questions";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var PlanReviewPanel_module_css_default = {
			"actions": "vMLJPa_actions",
			"card": "vMLJPa_card",
			"description": "vMLJPa_description",
			"discuss": "vMLJPa_discuss",
			"feedback": "vMLJPa_feedback",
			"footer": "vMLJPa_footer",
			"frame": "vMLJPa_frame",
			"previewActions": "vMLJPa_previewActions",
			"strip": "vMLJPa_strip",
			"summary": "vMLJPa_summary",
			"title": "vMLJPa_title"
		};
		//#endregion
		//#region src/client/PlanReviewPanel.tsx
		/**
		* Optional-prop spread for a decision button's tooltip: `title` is optional on
		* the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
		*
		* @param description - the asker's option description, when it carries one.
		* @returns The `title` prop to spread, or nothing.
		*/
		function tooltip(description) {
			return description === void 0 ? {} : { title: description };
		}
		/**
		* Render plan review controls; the submitted document opens in the sidebar.
		*
		* @param props - the question domain face, the narrowed plan review, and `t`.
		* @returns The plan-review takeover for this request.
		*/
		function PlanReviewPanel({ pending, review, t, renderSlot, gate }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const locked = busy || gate.locked;
			const cardState = pending.snapshot().state;
			(0, react.useEffect)(() => {
				if (cardState === "continued" && !gate.locked) setBusy(false);
			}, [cardState, gate.locked]);
			const settle = (send, channel = "none") => {
				if (!gate.canInteract() || !gate.beginSettlement()) return;
				setBusy(true);
				setError(null);
				gate.settle(send, channel).then(() => {
					if (channel !== "rpc") return;
					setBusy(false);
					pending.dismiss().catch(() => {
						setError(t("status.sent"));
					});
				}).catch(() => {
					setBusy(false);
					setError(null);
				});
			};
			const decide = (label) => {
				settle(() => pending.answer({ answers: [{
					id: review.id,
					selected: [label]
				}] }), pending.snapshot().channel);
			};
			const summary = (0, react.useMemo)(() => {
				const title = (0, _deepseek_ai_dsh_client_ui_primitives.extractMarkdownPlainText)(review.plan, { mode: "first-line" });
				const description = (0, _deepseek_ai_dsh_client_ui_primitives.extractMarkdownPlainText)(review.plan, { mode: "first-paragraph" });
				return {
					title,
					description: description === title ? "" : description
				};
			}, [review.plan]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: PlanReviewPanel_module_css_default.frame,
				"data-plan-review-key": pending.key,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: PlanReviewPanel_module_css_default.card,
					"aria-label": review.question,
					"aria-busy": busy,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PlanReviewPanel_module_css_default.strip,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: busy ? "ongoing" : "warning" }),
								t("plan.header"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: PlanReviewPanel_module_css_default.previewActions,
									children: renderSlot("conversation.plan-review.actions", {
										review,
										requestKey: pending.key
									})
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PlanReviewPanel_module_css_default.summary,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: PlanReviewPanel_module_css_default.title,
								children: summary.title
							}), summary.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PlanReviewPanel_module_css_default.description,
								children: summary.description
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PlanReviewPanel_module_css_default.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: PlanReviewPanel_module_css_default.feedback,
								role: "status",
								children: error ?? gate.error
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PlanReviewPanel_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									className: PlanReviewPanel_module_css_default.discuss,
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 14 }),
									disabled: locked,
									onClick: () => {
										settle(() => pending.dismiss());
									},
									children: t("plan.discuss")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									...tooltip(review.approve.description),
									disabled: locked,
									onClick: () => {
										decide(review.approve.label);
									},
									children: t("plan.approve")
								})]
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region \0dsh-css:G:\Projects\dsh-better-tasks\.srcbuild\packages\client\ui-user-questions\src\client\QuestionComposer.module.css.mjs
		const css$1 = ".QCE0CG_frame{padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px;justify-content:center;display:flex}.QCE0CG_card{width:100%;max-width:var(--dsh-chat-content-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2-darkmode-thin);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);max-height:min(60vh,520px);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:0 0 10px;display:flex;overflow:hidden}.QCE0CG_card,.QCE0CG_card *{box-sizing:border-box}.QCE0CG_cardMinimized{max-height:none}.QCE0CG_cardMinimized .QCE0CG_header{padding-bottom:14px}.QCE0CG_headerActions{flex-shrink:0;align-items:center;gap:4px;display:flex}.QCE0CG_waitButton{white-space:nowrap}.QCE0CG_waitStatus{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:12px;line-height:24px}.QCE0CG_header{flex-shrink:0;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 16px 0 24px;display:flex}.QCE0CG_headingBlock{min-width:0}.QCE0CG_eyebrow{color:var(--dsw-alias-label-tertiary);margin-bottom:5px;font-size:11px;line-height:16px}.QCE0CG_title{margin:0;font-size:16px;font-weight:500;line-height:22px}.QCE0CG_detail{margin:0 2px 8px}.QCE0CG_footerActions{flex-shrink:0;align-items:center;gap:12px;display:flex}.QCE0CG_pager{flex-shrink:0;align-items:center;gap:6px;display:flex}.QCE0CG_progress{color:var(--dsw-alias-label-secondary);white-space:nowrap;word-spacing:-2px;padding:0 4px;font-size:14px;font-weight:500;line-height:24px}.QCE0CG_iconButton{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;place-items:center;padding:0;display:grid}.QCE0CG_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.QCE0CG_iconButton:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.QCE0CG_body{overscroll-behavior:contain;flex-direction:column;flex:auto;min-height:0;display:flex;overflow-y:auto}.QCE0CG_options{flex-direction:column;gap:1px;margin:8px 0 0;padding:4px 12px;display:flex}.QCE0CG_option{border-radius:var(--dsw-radius-md);width:100%;min-height:40px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;flex-shrink:0;align-items:flex-start;gap:8px;padding:8px 12px 8px 8px;transition:background-color .12s,border-color .12s;display:flex}.QCE0CG_option:hover:not(:disabled),.QCE0CG_optionSelected{background:var(--dsw-alias-interactive-bg-hover)}.QCE0CG_optionSelected{border-color:var(--dsw-alias-border-l2)}.QCE0CG_option:disabled{cursor:default}.QCE0CG_number{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-overlay);width:20px;height:20px;color:var(--dsw-alias-label-secondary);flex:0 0 20px;place-items:center;margin-top:2px;font-size:12px;font-weight:500;line-height:18px;display:grid}.QCE0CG_checkbox{flex:0 0 20px;place-items:center;width:20px;height:20px;margin-top:2px;display:grid}.QCE0CG_checkbox:before{content:\"\";border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xs);grid-area:1/1;width:14px;height:14px;transition:background-color .12s,border-color .12s}.QCE0CG_checkbox>svg{grid-area:1/1}.QCE0CG_checkboxChecked{color:var(--dsw-alias-label-primary-foreground)}.QCE0CG_checkboxChecked:before{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-label-primary)}.QCE0CG_optionCopy{flex:1;min-width:0}.QCE0CG_optionLine{flex-wrap:wrap;align-items:baseline;gap:2px 6px;display:flex}.QCE0CG_optionLabel{font-size:14px;font-weight:500;line-height:24px}.QCE0CG_badge{border-radius:var(--dsw-radius-xs);background:var(--dsw-specific-sidebar-nav-item-active-accent);color:var(--dsw-alias-button-info-fill);padding:0 4px;font-size:11px;font-weight:600;line-height:18px}.QCE0CG_description{color:var(--dsw-alias-label-tertiary);font-size:14px;font-weight:400;line-height:24px}.QCE0CG_reviewNote{color:var(--dsw-alias-label-tertiary);margin:0;padding:8px 12px;font-size:14px;line-height:24px}.QCE0CG_customRow{border-radius:var(--dsw-radius-md);border:1px solid #0000;flex-shrink:0;align-items:flex-start;gap:8px;width:100%;min-height:40px;padding:8px 12px 8px 8px;transition:background-color .12s,border-color .12s;display:flex}.QCE0CG_customRow:hover,.QCE0CG_customRow:focus-within,.QCE0CG_customRowActive{background:var(--dsw-alias-interactive-bg-hover)}.QCE0CG_customRow:focus-within,.QCE0CG_customRowActive{border-color:var(--dsw-alias-border-l2)}.QCE0CG_field{--dsh-answer-field-padding:0;min-width:0;display:grid}.QCE0CG_field>*{min-width:0;padding:var(--dsh-answer-field-padding);font:inherit;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;grid-area:1/1;font-size:14px;line-height:24px}.QCE0CG_fieldMirror{box-sizing:content-box;visibility:hidden;max-height:144px;overflow:hidden}.QCE0CG_fieldInput{resize:none;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);background:0 0;border:none;outline:none;overflow-y:auto}.QCE0CG_fieldInput::placeholder{color:var(--dsw-alias-label-caption)}.QCE0CG_customInline{flex:1}.QCE0CG_customBlock{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);--dsh-answer-field-padding:8px 12px;flex-shrink:0;min-height:64px;margin:0 12px}.QCE0CG_customBlock:focus-within{border-color:var(--dsw-alias-state-business-primary)}.QCE0CG_footer{flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;padding:0 10px 0 18px;display:flex}.QCE0CG_feedback{min-height:16px;color:var(--dsw-alias-state-error-primary);text-align:right;flex:1;font-size:11px;line-height:16px}@media (width<=720px){.QCE0CG_card{border-radius:var(--dsw-radius-xl)}.QCE0CG_header{padding:10px 12px 0 18px}.QCE0CG_options{padding:4px 8px}.QCE0CG_title{font-size:15px;line-height:21px}.QCE0CG_option,.QCE0CG_customRow{padding:8px 6px}.QCE0CG_footer{align-items:flex-end;padding:0 10px}.QCE0CG_footerActions{flex-shrink:0}}@media (prefers-reduced-motion:reduce){.QCE0CG_option,.QCE0CG_customRow{transition:none}}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-user-questions/QuestionComposer.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-user-questions";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var QuestionComposer_module_css_default = {
			"badge": "QCE0CG_badge",
			"body": "QCE0CG_body",
			"card": "QCE0CG_card",
			"cardMinimized": "QCE0CG_cardMinimized",
			"checkbox": "QCE0CG_checkbox",
			"checkboxChecked": "QCE0CG_checkboxChecked",
			"customBlock": "QCE0CG_customBlock",
			"customInline": "QCE0CG_customInline",
			"customRow": "QCE0CG_customRow",
			"customRowActive": "QCE0CG_customRowActive",
			"description": "QCE0CG_description",
			"detail": "QCE0CG_detail",
			"eyebrow": "QCE0CG_eyebrow",
			"feedback": "QCE0CG_feedback",
			"field": "QCE0CG_field",
			"fieldInput": "QCE0CG_fieldInput",
			"fieldMirror": "QCE0CG_fieldMirror",
			"footer": "QCE0CG_footer",
			"footerActions": "QCE0CG_footerActions",
			"frame": "QCE0CG_frame",
			"header": "QCE0CG_header",
			"headerActions": "QCE0CG_headerActions",
			"headingBlock": "QCE0CG_headingBlock",
			"iconButton": "QCE0CG_iconButton",
			"number": "QCE0CG_number",
			"option": "QCE0CG_option",
			"optionCopy": "QCE0CG_optionCopy",
			"optionLabel": "QCE0CG_optionLabel",
			"optionLine": "QCE0CG_optionLine",
			"optionSelected": "QCE0CG_optionSelected",
			"options": "QCE0CG_options",
			"pager": "QCE0CG_pager",
			"progress": "QCE0CG_progress",
			"reviewNote": "QCE0CG_reviewNote",
			"title": "QCE0CG_title",
			"waitButton": "QCE0CG_waitButton",
			"waitStatus": "QCE0CG_waitStatus"
		};
		//#endregion
		//#region src/client/QuestionComposer.tsx
		/** A removed card can remain mounted until the composer seat updates. */
		const REMOVED_CARD = {
			state: "open",
			waitState: "counting",
			countdown: void 0,
			channel: "none",
			closed: true
		};
		/**
		* Split the conventional recommendation suffix without changing the answer value.
		* @param label - Original option label returned if selected.
		* @returns Display label plus recommendation state.
		*/
		function parseRecommendedLabel(label) {
			const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
			return suffix.test(label) ? {
				label: label.replace(suffix, ""),
				recommended: true
			} : {
				label,
				recommended: false
			};
		}
		/** Only a marked first choice is an implicit draft; the user still submits it. */
		function recommendedFirstOption(question) {
			const label = question.options?.[0]?.label;
			return label !== void 0 && parseRecommendedLabel(label).recommended ? label : void 0;
		}
		/** Accept persisted progress only when it still describes this question batch. */
		function isQuestionDraftProgress(value, questionCount) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const progress = value;
			if (typeof progress.index !== "number" || !Number.isInteger(progress.index) || progress.index < 0 || progress.index >= questionCount || !Array.isArray(progress.drafts) || progress.drafts.length !== questionCount || progress.wait !== void 0 && progress.wait !== "editing" && progress.wait !== "waiting") return false;
			return progress.drafts.every((item) => {
				if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
				const draft = item;
				return Array.isArray(draft.selected) && draft.selected.every((label) => typeof label === "string") && typeof draft.custom === "string" && typeof draft.skipped === "boolean";
			});
		}
		/** Return whether a text-field key event belongs to an active IME composition. */
		function isComposing(event) {
			return event.nativeEvent.isComposing || Reflect.get(event.nativeEvent, "keyCode") === 229;
		}
		/**
		* Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
		* Shift+Enter breaks a line, over a hidden mirror that owns the height.
		*
		* The mirror renders the draft plus a trailing newline in normal flow and so
		* sizes the grid row (counting rows by '\n' cannot see soft wraps); the
		* textarea shares that one cell and stretches to it, and `rows={1}` keeps the
		* control's own intrinsic height out of the row sizing so the mirror alone
		* decides. Past the mirror's cap the textarea scrolls itself — it is the only
		* scrollport in the stack, there being no second glyph layer to keep aligned.
		* Mirror and textarea MUST share font, line-height, padding and wrapping rules
		* or the two heights diverge.
		*
		* @param props - visual variant, draft text, and the field's event handlers.
		* @returns The mirrored auto-growing field.
		*/
		function AnswerField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(QuestionComposer_module_css_default.field, props.variant === "inline" ? QuestionComposer_module_css_default.customInline : QuestionComposer_module_css_default.customBlock),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"aria-hidden": true,
					className: QuestionComposer_module_css_default.fieldMirror,
					children: `${props.value}\n`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					autoFocus: props.autoFocus,
					className: QuestionComposer_module_css_default.fieldInput,
					value: props.value,
					disabled: props.disabled,
					rows: 1,
					placeholder: props.placeholder,
					onFocus: props.onFocus,
					onChange: props.onChange,
					onKeyDown: props.onKeyDown
				})]
			});
		}
		/**
		* Composer takeover router. Generic-question drafts live in this entry's
		* Session-scoped Slot store, keyed by the pending carrier, so a strict Session
		* entry remount restores the same request without exposing it to another one.
		*
		* One takeover, two presentations: a request that declares a presentation intent this
		* package renders uses that presentation (a plan review is one decision over one
		* plan, not a question set), and every other request takes the generic flow.
		* The routing lives here, at the one entry that owns the composer seat, so
		* neither presentation can claim a request the other is already rendering.
		*
		* @param props - the selector-matched pending question carrier plus the framework standard kit.
		* @returns The question flow, or the intent's own surface, for this request.
		*/
		function QuestionComposer(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuestionSurface, {
				pending: props.matched,
				registry: props.registry,
				variant: "composer",
				t: props.t,
				useStore: props.useStore,
				useQuestionCard: props.useQuestionCard,
				actions: props.actions,
				renderSlot: props.renderSlot
			});
		}
		/**
		* One shared surface implementation for every seat a pending question appears
		* in. It resolves the request's registry record, subscribes to the record's
		* revision, and publishes the surface discriminator as `data-question-surface`
		* so a host can target it without reaching into this package's CSS modules.
		*
		* @param props - the carrier, its registry, the surface discriminator, and the standard kit.
		* @returns The question flow, or the intent's own presentation, for this request.
		*/
		function QuestionSurface({ pending, registry, variant, store, isAvailable, useStore: seatUseStore, actions: seatActions, ...kit }) {
			const record = (0, react.useMemo)(() => registry.record(pending), [registry, pending]);
			(0, react.useSyncExternalStore)((listener) => registry.subscribe(record, listener), () => record.version, () => record.version);
			const hostSnapshot = (0, react.useSyncExternalStore)(store?.subscribe ?? NO_SUBSCRIPTION, store?.getSnapshot ?? NO_SNAPSHOT, store?.getSnapshot ?? NO_SNAPSHOT);
			const storeUseStore = (0, react.useMemo)(() => (selector) => selector(hostSnapshot), [hostSnapshot]);
			const useStore = store === void 0 ? seatUseStore : storeUseStore;
			const actions = store === void 0 ? seatActions : store.actions;
			const review = (0, react.useMemo)(() => planReviewOf(pending.questions), [pending]);
			const gate = (0, react.useMemo)(() => {
				let attempt;
				const available = () => (isAvailable?.() ?? true) && registry.canInteract(record);
				return {
					locked: record.locked || !registry.isCurrent(record) || !(isAvailable?.() ?? true),
					error: record.error,
					canInteract: available,
					clearError: () => {
						registry.clearError(record);
					},
					beginSettlement: () => {
						if (!available()) return false;
						attempt = registry.beginSettlement(record);
						return attempt !== void 0;
					},
					settle: (send, channel = "none") => registry.settle(record, attempt, send, channel)
				};
			}, [
				registry,
				record,
				record.locked,
				record.error,
				record.version,
				isAvailable
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-question-surface": variant,
				"data-question-key": pending.key,
				...variant === "task-card" ? { "data-no-card-drag": true } : {},
				onDragStart: (event) => {
					if (variant === "task-card") event.preventDefault();
				},
				children: review === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuestionFlow, {
					pending,
					gate,
					useStore,
					actions,
					cardSurface: variant === "task-card",
					...kit
				}, pending.key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanReviewPanel, {
					pending,
					review,
					gate,
					t: kit.t,
					renderSlot: kit.renderSlot
				}, pending.key)
			});
		}
		/** Stable no-op sources for a seat that binds the framework store instead. */
		const NO_SUBSCRIPTION = () => () => {};
		const NO_SNAPSHOT = () => void 0;
		function QuestionFlow({ pending, gate, t, useStore, useQuestionCard, actions, cardSurface = false }) {
			const domId = (0, react.useId)();
			const focusOwner = (0, react.useRef)({});
			const questions = pending.questions;
			const review = pending.review;
			const markdownLabels = (0, react.useMemo)(() => ({
				code: {
					copyLabel: t("copy"),
					copiedLabel: t("copied"),
					toolbarLabels: {
						codeLabel: t("codeBlock.title"),
						wrapLabel: t("codeBlock.wrap"),
						unwrapLabel: t("codeBlock.unwrap")
					}
				},
				footnotes: t("markdown.footnotes")
			}), [t]);
			const initialDrafts = (0, react.useMemo)(() => {
				const recorded = new Map((review ?? []).map((answer) => [answer.id, answer]));
				return questions.map((item) => {
					const answer = recorded.get(item.id);
					const custom = answer?.custom ?? "";
					const recommended = review === void 0 ? recommendedFirstOption(item) : void 0;
					return {
						selected: answer === void 0 && recommended !== void 0 ? [recommended] : [...answer?.selected ?? []],
						custom,
						skipped: answer !== void 0 && answer.selected.length === 0 && custom === ""
					};
				});
			}, [questions, review]);
			const stored = useStore((state) => state.progressByRequest[pending.key]);
			const validStored = isQuestionDraftProgress(stored, questions.length) ? stored : void 0;
			const storedProgress = review === void 0 ? validStored : void 0;
			const index = validStored?.index ?? 0;
			const drafts = storedProgress?.drafts ?? initialDrafts;
			const restoredWait = storedProgress?.wait ?? (storedProgress?.drafts.some((item, itemIndex) => item.selected.length !== initialDrafts[itemIndex]?.selected.length || item.selected.some((label, labelIndex) => label !== initialDrafts[itemIndex]?.selected[labelIndex]) || item.custom !== "" || item.skipped) === true ? "editing" : void 0);
			const [busy, setBusy] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const card = useQuestionCard(pending.key, (snapshot) => snapshot ?? REMOVED_CARD);
			const canSubmit = card.channel !== "none";
			const locked = busy !== null || review !== void 0 || gate.locked;
			const sentVia = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (sentVia.current !== "waterfall" || card.state !== "continued") return;
				sentVia.current = null;
				setBusy(null);
				setError({ key: "error.resubmit" });
			}, [card.state]);
			(0, react.useEffect)(() => {
				if (card.closed) actions.clear(pending.key);
			}, [
				actions,
				card.closed,
				pending.key
			]);
			(0, react.useEffect)(() => {
				actions.prune(pending.liveKeys());
			}, [actions, pending]);
			const waitDisposition = (0, react.useRef)(restoredWait);
			(0, react.useEffect)(() => {
				if (waitDisposition.current === "waiting") pending.takeTime();
				if (waitDisposition.current === "editing") pending.engage();
			}, [pending]);
			const countdown = card.countdown;
			const [minimized, setMinimized] = (0, react.useState)(false);
			const focusedQuestions = (0, react.useRef)(/* @__PURE__ */ new Set());
			const answerSurface = (0, react.useRef)(null);
			const question = questions[index];
			const draft = drafts[index];
			const hasOptions = (question.options?.length ?? 0) > 0;
			const replaceProgress = (nextIndex, nextDrafts) => {
				actions.replace(pending.key, {
					index: nextIndex,
					drafts: nextDrafts,
					...waitDisposition.current === void 0 ? {} : { wait: waitDisposition.current }
				});
			};
			const takeTime = () => {
				if (locked || !gate.canInteract()) return;
				waitDisposition.current = "waiting";
				pending.takeTime();
				replaceProgress(index, drafts);
			};
			const engage = () => {
				if (waitDisposition.current !== void 0) return;
				waitDisposition.current = "editing";
				pending.engage();
			};
			const focusAnswerSurface = (event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) pending.holdFocus(Date.now(), focusOwner.current);
			};
			const blurAnswerSurface = (event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) pending.releaseFocus(Date.now(), focusOwner.current);
			};
			(0, react.useEffect)(() => {
				const release = () => {
					pending.releaseFocus(Date.now(), focusOwner.current);
				};
				const refocus = () => {
					if (waitDisposition.current === "editing") {
						pending.engage();
						return;
					}
					if (answerSurface.current?.contains(document.activeElement) === true) pending.holdFocus(Date.now(), focusOwner.current);
				};
				const visibilityChanged = () => {
					if (document.hidden) release();
					else refocus();
				};
				window.addEventListener("blur", release);
				window.addEventListener("focus", refocus);
				document.addEventListener("visibilitychange", visibilityChanged);
				return () => {
					release();
					window.removeEventListener("blur", release);
					window.removeEventListener("focus", refocus);
					document.removeEventListener("visibilitychange", visibilityChanged);
				};
			}, [pending]);
			const dismissFlow = () => {
				if (locked || !gate.canInteract()) return;
				if (cardSurface && pending.dismissal === "hide") {
					setMinimized(true);
					return;
				}
				if (pending.dismissal === "hide") {
					pending.dismiss();
					return;
				}
				if (!canSubmit) {
					setError({ key: "error.unavailable" });
					return;
				}
				if (!gate.beginSettlement()) return;
				setBusy("cancel");
				setError(null);
				sentVia.current = "waterfall";
				gate.settle(() => pending.dismiss(), "waterfall").catch(() => {
					sentVia.current = null;
					setBusy(null);
					setError(null);
				});
			};
			const updateDraft = (update, nextIndex = index) => {
				if (locked || !gate.canInteract()) return;
				gate.clearError();
				engage();
				const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item);
				replaceProgress(nextIndex, nextDrafts);
				setError(null);
			};
			const choose = (label) => {
				updateDraft((current) => {
					if (question.multiSelect === true) {
						const selected = current.selected.includes(label) ? current.selected.filter((item) => item !== label) : [...current.selected, label];
						return {
							...current,
							selected,
							skipped: false
						};
					}
					return {
						selected: [label],
						custom: "",
						skipped: false
					};
				}, question.multiSelect !== true && index < questions.length - 1 ? index + 1 : index);
			};
			const answered = (item) => item.selected.length > 0 || item.custom.trim() !== "";
			const completed = (item) => answered(item) || item.skipped;
			const submitDrafts = (values) => {
				if (locked || !gate.canInteract()) return;
				const missing = values.findIndex((item) => !completed(item));
				if (missing >= 0) {
					replaceProgress(missing, values);
					setError({ key: "error.incomplete" });
					return;
				}
				if (!canSubmit) {
					setError({ key: "error.unavailable" });
					return;
				}
				if (!gate.beginSettlement()) return;
				const answer = { answers: questions.map((item, itemIndex) => {
					const value = values[itemIndex];
					if (value.skipped) return {
						id: item.id,
						selected: []
					};
					const custom = value.custom.trim();
					return {
						id: item.id,
						selected: custom === "" || item.multiSelect === true ? value.selected : [],
						...custom === "" ? {} : { custom }
					};
				}) };
				setBusy("answer");
				setError(null);
				const channel = pending.snapshot().channel;
				sentVia.current = channel === "waterfall" ? "waterfall" : null;
				gate.settle(() => pending.answer(answer), channel).then(() => {
					if (channel !== "rpc") return;
					sentVia.current = null;
					setBusy(null);
					setError(null);
					pending.dismiss().catch(() => {
						setError({ key: "status.sent" });
					});
				}).catch(() => {
					sentVia.current = null;
					setBusy(null);
					setError(null);
				});
			};
			const continueFlow = () => {
				if (locked || !gate.canInteract()) return;
				if (!answered(draft)) {
					setError({ key: "error.unanswered" });
					return;
				}
				if (index < questions.length - 1) {
					replaceProgress(index + 1, drafts);
					setError(null);
					return;
				}
				submitDrafts(drafts);
			};
			const draftCustom = (event) => {
				const value = event.target.value;
				updateDraft((current) => ({
					...current,
					selected: question.multiSelect === true ? current.selected : [],
					custom: value,
					skipped: false
				}));
			};
			const continueFromCustom = (event) => {
				if (event.key !== "Enter" || event.shiftKey || isComposing(event)) return;
				event.preventDefault();
				continueFlow();
			};
			const skipQuestion = () => {
				if (locked || !gate.canInteract()) return;
				gate.clearError();
				engage();
				const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index ? {
					selected: [],
					custom: "",
					skipped: true
				} : item);
				replaceProgress(index < questions.length - 1 ? index + 1 : index, nextDrafts);
				setError(null);
				if (index < questions.length - 1) return;
				submitDrafts(nextDrafts);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: QuestionComposer_module_css_default.frame,
				"data-question-key": pending.key,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: clsx(QuestionComposer_module_css_default.card, minimized && QuestionComposer_module_css_default.cardMinimized),
					"aria-labelledby": `question-${pending.key}-${String(index)}-${domId}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: QuestionComposer_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: QuestionComposer_module_css_default.headingBlock,
							children: [question.header !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: QuestionComposer_module_css_default.eyebrow,
								children: question.header
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: QuestionComposer_module_css_default.title,
								id: `question-${pending.key}-${String(index)}-${domId}`,
								children: question.question
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: QuestionComposer_module_css_default.headerActions,
							children: [
								countdown !== void 0 && card.waitState !== "waiting" && card.waitState !== "editing" && card.waitState !== "continued" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: QuestionComposer_module_css_default.waitStatus,
									children: t(countdown.running ? "wait.countdown" : "wait.paused", { seconds: Math.ceil(countdown.remainingMs / 1e3) })
								}),
								countdown !== void 0 && card.waitState !== "waiting" && card.waitState !== "editing" && card.waitState !== "continued" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									className: QuestionComposer_module_css_default.waitButton,
									disabled: locked,
									onClick: takeTime,
									children: t("wait.takeTime")
								}),
								card.state === "continued" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: QuestionComposer_module_css_default.waitStatus,
									children: t("wait.continued")
								}),
								countdown !== void 0 && (card.waitState === "waiting" || card.waitState === "editing") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: QuestionComposer_module_css_default.waitStatus,
									children: t("wait.held")
								}),
								review !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: QuestionComposer_module_css_default.waitStatus,
									children: t("review.status")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: QuestionComposer_module_css_default.iconButton,
									"aria-label": t(minimized ? "nav.maximize" : "nav.minimize"),
									title: t(minimized ? "nav.maximize" : "nav.minimize"),
									"aria-expanded": !minimized,
									disabled: locked,
									onClick: () => {
										setMinimized((current) => !current);
									},
									children: minimized ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: QuestionComposer_module_css_default.iconButton,
									"aria-label": t(pending.dismissal === "hide" ? "nav.close" : "nav.cancel"),
									title: t(pending.dismissal === "hide" ? "nav.close" : "nav.cancel"),
									disabled: locked,
									onClick: dismissFlow,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, {})
								})
							]
						})]
					}), !minimized && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: answerSurface,
						className: QuestionComposer_module_css_default.body,
						"data-question-scroll": true,
						onFocusCapture: focusAnswerSurface,
						onBlurCapture: blurAnswerSurface,
						children: [question.detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: QuestionComposer_module_css_default.detail,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
								text: question.detail,
								labels: markdownLabels
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: QuestionComposer_module_css_default.options,
							role: question.multiSelect === true ? "group" : "radiogroup",
							children: [
								(question.options ?? []).map((option, optionIndex) => {
									const selected = draft.selected.includes(option.label);
									const display = parseRecommendedLabel(option.label);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: clsx(QuestionComposer_module_css_default.option, selected && question.multiSelect !== true && QuestionComposer_module_css_default.optionSelected),
										role: question.multiSelect === true ? "checkbox" : "radio",
										"aria-checked": selected,
										"aria-label": display.label,
										disabled: locked,
										onClick: () => {
											choose(option.label);
										},
										onKeyDown: (event) => {
											if (event.key !== "Enter") return;
											event.preventDefault();
											submitDrafts(drafts);
										},
										children: [question.multiSelect === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: clsx(QuestionComposer_module_css_default.checkbox, selected && QuestionComposer_module_css_default.checkboxChecked),
											"aria-hidden": "true",
											children: selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 })
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: QuestionComposer_module_css_default.number,
											children: optionIndex + 1
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: QuestionComposer_module_css_default.optionCopy,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: QuestionComposer_module_css_default.optionLine,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: QuestionComposer_module_css_default.optionLabel,
														children: display.label
													}),
													display.recommended && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: QuestionComposer_module_css_default.badge,
														children: t("option.recommended")
													}),
													option.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: QuestionComposer_module_css_default.description,
														children: option.description
													})
												]
											})
										})]
									}, `${option.label}-${String(optionIndex)}`);
								}),
								review !== void 0 && draft.skipped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: QuestionComposer_module_css_default.reviewNote,
									children: t("review.skipped")
								}),
								(review === void 0 || draft.custom !== "") && (hasOptions ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: clsx(QuestionComposer_module_css_default.customRow, draft.custom !== "" && QuestionComposer_module_css_default.customRowActive),
									children: [question.multiSelect === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: clsx(QuestionComposer_module_css_default.checkbox, draft.custom !== "" && QuestionComposer_module_css_default.checkboxChecked),
										"aria-hidden": "true",
										children: draft.custom !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 })
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: QuestionComposer_module_css_default.number,
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 12 })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnswerField, {
										variant: "inline",
										value: draft.custom,
										disabled: locked,
										placeholder: t("custom.placeholder"),
										onChange: draftCustom,
										onKeyDown: continueFromCustom
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnswerField, {
									autoFocus: !cardSurface && canSubmit && countdown === void 0 && !locked && !focusedQuestions.current.has(index),
									variant: "block",
									value: draft.custom,
									disabled: locked,
									placeholder: t("custom.placeholder"),
									onFocus: () => {
										focusedQuestions.current.add(index);
									},
									onChange: draftCustom,
									onKeyDown: continueFromCustom
								}))
							]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: QuestionComposer_module_css_default.footer,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: QuestionComposer_module_css_default.pager,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: QuestionComposer_module_css_default.iconButton,
										"aria-label": t("nav.prev"),
										disabled: index === 0 || locked,
										onClick: () => {
											replaceProgress(index - 1, drafts);
											setError(null);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, {})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: QuestionComposer_module_css_default.progress,
										children: [
											index + 1,
											" / ",
											questions.length
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: QuestionComposer_module_css_default.iconButton,
										"aria-label": t("nav.next"),
										disabled: index === questions.length - 1 || locked,
										onClick: () => {
											replaceProgress(index + 1, drafts);
											setError(null);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {})
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: QuestionComposer_module_css_default.feedback,
								role: "status",
								children: error === null ? gate.error === null ? null : gate.error : "key" in error ? t(error.key) : error.text
							}),
							review === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: QuestionComposer_module_css_default.footerActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: locked,
									onClick: skipQuestion,
									children: t("action.skip")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									disabled: locked || !answered(draft) || index === questions.length - 1 && !canSubmit,
									onClick: continueFlow,
									children: busy === "answer" ? t("submitting") : index === questions.length - 1 ? t("submit") : t("action.next")
								})]
							})
						]
					})] })]
				})
			});
		}
		//#endregion
		//#region src/client/draft-store.ts
		/**
		* Session-scoped draft state for the generic question composer. The Slot
		* registry owns store instances; this module exports only the factory so a
		* plugin reload cannot reuse a module-global handle.
		*/
		/** Fresh per-instance state; shared by both declarations below. */
		const draftInit = () => ({ progressByRequest: {} });
		/**
		* The composer's draft write set. Declared once so the persisted seat store and
		* the persist-free surface store below cannot drift apart.
		*/
		const draftActions = {
			replace: (draft, requestKey, progress) => {
				draft.progressByRequest[requestKey] = progress;
			},
			clear: (draft, requestKey) => {
				draft.progressByRequest = Object.fromEntries(Object.entries(draft.progressByRequest).filter(([key]) => key !== requestKey));
			},
			prune: (draft, keep) => {
				const live = new Set(keep);
				draft.progressByRequest = Object.fromEntries(Object.entries(draft.progressByRequest).filter(([key]) => live.has(key)));
			}
		};
		/**
		* Declare the question composer's Session store. Drafts persist per Session so
		* leaving the Session or restarting the Client does not erase an unfinished answer.
		* @returns a persisted store handle whose instance is owned by the Slot registry.
		*/
		function createQuestionDraftStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: draftInit,
				persist: "dsh.user-questions.drafts.v1",
				actions: draftActions
			});
		}
		//#endregion
		//#region src/client/question-surface.ts
		/** Shared Session-scoped drafts and single-flight settlement for native and card seats. */
		/** One store instance per resolved persistence key; card and Slot share the actual object. */
		var QuestionSurfaceRegistry = class {
			options;
			#records = /* @__PURE__ */ new Map();
			#stores = /* @__PURE__ */ new Map();
			#draft = createQuestionDraftStore();
			#sequence = 0;
			#disposed = false;
			draftStore;
			constructor(options) {
				this.options = options;
				this.draftStore = {
					spec: this.#draft.spec,
					create: (scopeKey) => {
						if (scopeKey === void 0 || scopeKey === "") throw new Error("Question drafts require a Session scope");
						return this.storeFor(scopeKey);
					}
				};
			}
			storeFor(sessionId) {
				const existing = this.#stores.get(sessionId);
				if (existing !== void 0) return existing;
				if (this.#disposed) throw new Error("Question surface registry is closed");
				const store = this.#draft.create(sessionId);
				this.#stores.set(sessionId, store);
				return store;
			}
			record(pending) {
				const id = `${pending.sessionId}:${pending.key}`, binding = this.options.bindingOf(pending.sessionId);
				const existing = this.#records.get(id);
				if (existing?.pending === pending && existing.binding === binding && existing.alive) return existing;
				if (existing !== void 0) this.#invalidate(existing);
				const record = {
					id,
					pending,
					binding,
					store: this.storeFor(pending.sessionId),
					locked: false,
					error: null,
					version: 0,
					alive: true,
					sentVia: "none",
					attempt: void 0,
					listeners: /* @__PURE__ */ new Set(),
					offPending: () => {}
				};
				this.#records.set(id, record);
				record.offPending = pending.subscribe(() => {
					if (pending.snapshot().closed || !this.isCurrent(record)) this.#invalidate(record);
					else {
						if (record.attempt === void 0 && record.sentVia === "waterfall" && pending.snapshot().state === "continued") {
							record.locked = false;
							record.sentVia = "none";
							record.error = this.options.resubmitMessage();
						}
						this.#notify(record);
					}
				});
				return record;
			}
			isCurrent(record) {
				return !this.#disposed && record.alive && this.#records.get(record.id) === record && this.options.isCurrent(record.pending) && !record.pending.snapshot().closed && record.binding !== void 0 && this.options.bindingOf(record.pending.sessionId) === record.binding;
			}
			subscribe(record, listener) {
				record.listeners.add(listener);
				return () => {
					record.listeners.delete(listener);
				};
			}
			canInteract(record) {
				return this.isCurrent(record) && !record.locked;
			}
			beginSettlement(record) {
				if (!this.canInteract(record)) return void 0;
				const completion = Promise.withResolvers();
				const id = ++this.#sequence;
				record.attempt = {
					id,
					channel: "none",
					completion: completion.promise,
					finish: () => {
						completion.resolve();
					}
				};
				record.locked = true;
				record.error = null;
				this.#notify(record);
				return id;
			}
			settle(record, token, send, channel) {
				const attempt = record.attempt;
				if (token === void 0 || attempt?.id !== token) return Promise.reject(/* @__PURE__ */ new Error("Question settlement is not owned by this surface"));
				attempt.channel = channel;
				let work;
				try {
					if (!this.isCurrent(record)) throw new Error("This question is no longer current");
					work = this.options.runOperation(record, send);
				} catch (error) {
					work = Promise.reject(error);
				}
				return Promise.resolve(work).then(() => {
					if (record.attempt !== attempt) return;
					record.sentVia = channel;
					if (channel === "none") record.locked = false;
					if (channel === "waterfall" && record.pending.snapshot().state === "continued") {
						record.locked = false;
						record.sentVia = "none";
						record.error = this.options.resubmitMessage();
					}
				}, (error) => {
					if (record.attempt === attempt && this.isCurrent(record)) {
						record.locked = false;
						record.sentVia = "none";
						record.error = error instanceof Error ? error.message : String(error);
					}
					throw error;
				}).finally(() => {
					if (record.attempt === attempt) record.attempt = void 0;
					attempt.finish();
					this.#notify(record);
				});
			}
			clearError(record) {
				if (record.error === null || !this.canInteract(record)) return;
				record.error = null;
				this.#notify(record);
			}
			whenSettled(record) {
				return record.attempt?.completion ?? Promise.resolve();
			}
			/** Forget presentation ownership, NOT persisted drafts on ordinary scope release. */
			forget(pending) {
				const id = `${pending.sessionId}:${pending.key}`, record = this.#records.get(id);
				if (record?.pending !== pending) return;
				this.#invalidate(record);
				this.#records.delete(id);
			}
			dispose() {
				if (this.#disposed) return;
				this.#disposed = true;
				for (const record of this.#records.values()) this.#invalidate(record);
				this.#records.clear();
				this.#stores.clear();
			}
			#invalidate(record) {
				if (!record.alive) return;
				record.alive = false;
				record.locked = true;
				record.offPending();
				this.#notify(record);
			}
			#notify(record) {
				record.version += 1;
				for (const listener of [...record.listeners]) listener();
			}
		};
		//#endregion
		//#region src/client/surface-card.tsx
		/** Same durable Inbox exclusion as the native continued-question reconciler. */
		function queuedQuestionReplies(inbox) {
			const queued = /* @__PURE__ */ new Set();
			for (const message of [...inbox?.["next-step"] ?? [], ...inbox?.["next-turn"] ?? []]) {
				if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
				const source = message.source;
				if (typeof source === "object" && source !== null && !Array.isArray(source) && source.kind === "user-question-reply" && typeof source.callId === "string") queued.add(source.callId);
			}
			return queued;
		}
		function projections(sessions, sessionId) {
			const binding = sessions.binding(sessionId);
			const list = sessions.list.getSnapshot();
			const metadata = list.byId[sessionId]?.projectionValues ?? list.projectionsBySession[sessionId]?.values;
			return {
				questions: binding?.session.projections.faceOf("userQuestions").getSnapshot() ?? metadata?.userQuestions,
				inbox: binding?.session.projections.faceOf("inbox").getSnapshot() ?? metadata?.inbox
			};
		}
		function targetOf(pending) {
			return {
				sessionId: pending.sessionId,
				requestKey: pending.key,
				kind: pending.kind,
				...pending.callId === void 0 ? {} : { callId: pending.callId }
			};
		}
		/** Discover existing data only. The caller's existing list/status hooks drive refresh. */
		function findQuestionCard(ctx, cards, sessionId) {
			const sessions = ctx.get("sessions");
			if (sessions === void 0 || sessionId === "") return void 0;
			const id = sessionId, view = projections(sessions, id), queued = queuedQuestionReplies(view.inbox);
			const answerable = (pending) => pending.sessionId === id && pending.review === void 0 && !pending.snapshot().closed && cards.source(pending.key) === pending && !(pending.snapshot().state === "continued" && pending.callId !== void 0 && queued.has(pending.callId));
			const active = ctx.get("uiSession")?.sessionStatus.getSnapshot().get(id)?.pendingInteraction;
			if (active instanceof PendingQuestion && answerable(active)) return targetOf(active);
			const live = cards.values().map(({ pending }) => pending).filter(answerable);
			const current = live.filter((pending) => pending.kind === "plan-review").at(-1) ?? live.at(-1);
			if (current !== void 0) return targetOf(current);
			const candidates = /* @__PURE__ */ new Map();
			for (const row of view.questions?.active ?? []) {
				if (row.state === "continued" && queued.has(row.callId)) continue;
				candidates.set(PendingQuestion.keyOf(id, row.callId), {
					sessionId,
					callId: row.callId,
					requestKey: PendingQuestion.keyOf(id, row.callId),
					kind: planReviewOf(row.questions) === void 0 ? "question" : "plan-review"
				});
			}
			const values = [...candidates.values()];
			return values.filter((value) => value.kind === "plan-review").at(-1) ?? values.at(-1);
		}
		/** Bind the real PendingQuestion observable, rather than pretending source(key) is a React hook. */
		function createQuestionCardHook(pending) {
			return ((key, select) => {
				const snapshot = (0, react.useSyncExternalStore)(pending.subscribe, pending.getSnapshot, pending.getSnapshot);
				const value = key === pending.key ? snapshot : void 0;
				return select === void 0 ? value : select(value);
			});
		}
		/** Retain one exact Session generation and one exact request; never navigate or reveal a native seat. */
		async function createQuestionCard(ctx, cards, registry, reconcile, options, t) {
			const sessions = ctx.get("sessions");
			if (sessions === void 0) throw new Error("Session retention is unavailable");
			if (typeof options.sessionId !== "string" || options.sessionId === "") throw new Error("A question Session is required");
			const id = options.sessionId;
			if (options.requestKey === void 0 && options.callId === void 0) throw new Error("An exact question identity is required");
			if (options.callId !== void 0 && (typeof options.callId !== "string" || options.callId === "")) throw new Error("Invalid question call identity");
			const key = options.requestKey ?? PendingQuestion.keyOf(id, options.callId);
			if (typeof key !== "string" || key === "") throw new Error("Invalid question request identity");
			if (options.callId !== void 0 && key !== PendingQuestion.keyOf(id, options.callId)) throw new Error("Question key and call identity disagree");
			options.signal?.throwIfAborted();
			const originalPending = cards.source(key);
			const reference = sessions.retain(id, {
				source: "controllerOperation",
				signal: options.signal
			});
			let handedOff = false;
			try {
				const binding = reference.binding;
				if (await reference.ready !== binding) throw new Error("Question Session generation changed");
				options.signal?.throwIfAborted();
				if (sessions.binding(id) !== binding || binding.session.getSnapshot().removed || binding.session.getSnapshot().openState !== "open") throw new Error("Question Session is unavailable");
				const state = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({ phase: "waiting" });
				const ended = Promise.withResolvers();
				const stops = [];
				let closing = false, pending, record;
				let stopPending, removeOwner, removeGeneration;
				const available = () => !closing && sessions.binding(id) === binding && !binding.session.getSnapshot().removed && binding.session.getSnapshot().openState === "open" && pending !== void 0 && cards.source(key) === pending && pending.sessionId === id && pending.key === key && (options.callId === void 0 || pending.callId === options.callId) && !pending.snapshot().closed && !(pending.snapshot().state === "continued" && pending.callId !== void 0 && queuedQuestionReplies(projections(sessions, id).inbox).has(pending.callId));
				const publish = (next) => {
					const old = state.getSnapshot();
					if (old.phase !== next.phase || old.kind !== next.kind || old.message !== next.message) state.set(next);
				};
				const finish = (terminal) => {
					if (closing) return;
					closing = true;
					const cleanups = [
						stopPending,
						...stops.splice(0),
						removeOwner,
						removeGeneration
					];
					options.signal?.removeEventListener("abort", dispose);
					const drain = async () => {
						try {
							for (const off of cleanups) try {
								await off?.();
							} catch {}
							if (record !== void 0) await registry.whenSettled(record);
						} catch {} finally {
							try {
								reference.release();
							} catch {} finally {
								ended.resolve();
							}
						}
					};
					drain();
					publish(terminal);
				};
				const dispose = () => {
					finish({ phase: "closed" });
				};
				const observe = () => {
					if (closing) return;
					if (sessions.binding(id) !== binding || binding.session.getSnapshot().removed) {
						dispose();
						return;
					}
					const sessionState = binding.session.getSnapshot();
					if (sessionState.openState === "error") {
						finish({
							phase: "error",
							message: "Question Session is unavailable"
						});
						return;
					}
					if (sessionState.openState !== "open") {
						publish({ phase: "waiting" });
						return;
					}
					const candidate = cards.source(key);
					if (originalPending !== void 0 && candidate !== originalPending) {
						dispose();
						return;
					}
					if (candidate !== void 0) {
						if (candidate.sessionId !== id || candidate.key !== key || options.callId !== void 0 && candidate.callId !== options.callId) {
							finish({
								phase: "error",
								message: "Question identity changed"
							});
							return;
						}
						if (pending !== void 0 && candidate !== pending) {
							dispose();
							return;
						}
						if (candidate.review !== void 0 || candidate.snapshot().closed) {
							dispose();
							return;
						}
						if (candidate.kind === "plan-review") {
							finish({
								phase: "unsupported",
								kind: "plan-review"
							});
							return;
						}
						if (pending === void 0) {
							pending = candidate;
							record = registry.record(candidate);
							stopPending = candidate.subscribe(observe);
						}
						const data = projections(sessions, id);
						if (candidate.snapshot().state === "continued" && candidate.callId !== void 0 && queuedQuestionReplies(data.inbox).has(candidate.callId)) {
							finish({
								phase: "closed",
								kind: candidate.kind
							});
							return;
						}
						publish({
							phase: candidate.snapshot().channel === "none" ? "waiting" : "ready",
							kind: candidate.kind
						});
						return;
					}
					if (pending !== void 0) {
						dispose();
						return;
					}
					const data = projections(sessions, id);
					const row = data.questions?.active.find((value) => PendingQuestion.keyOf(id, value.callId) === key);
					if (row !== void 0 && !(row.state === "continued" && queuedQuestionReplies(data.inbox).has(row.callId))) {
						const kind = planReviewOf(row.questions) === void 0 ? "question" : "plan-review";
						if (kind === "plan-review") finish({
							phase: "unsupported",
							kind
						});
						else publish({
							phase: "waiting",
							kind
						});
					} else if (data.questions !== void 0 || options.callId === void 0) dispose();
				};
				const refresh = () => {
					if (!closing) {
						reconcile();
						observe();
					}
				};
				const View = ({ fontSize, className }) => {
					if ((0, react.useSyncExternalStore)(state.subscribe, state.getSnapshot, state.getSnapshot).phase !== "ready" || pending === void 0 || !available()) return null;
					const style = typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0 ? { "--dsh-question-card-font-size": `${fontSize}px` } : void 0;
					return (0, react.createElement)("div", {
						className,
						style,
						"data-question-card-key": key
					}, (0, react.createElement)(QuestionSurface, {
						pending,
						registry,
						variant: "task-card",
						store: registry.storeFor(id),
						t,
						useQuestionCard: createQuestionCardHook(pending),
						renderSlot: () => null,
						isAvailable: available
					}));
				};
				try {
					stops.push(cards.subscribe(key, observe));
					stops.push(binding.session.projections.faceOf("userQuestions").subscribe(refresh));
					stops.push(binding.session.projections.faceOf("inbox").subscribe(refresh));
					stops.push(binding.session.subscribe(observe));
					stops.push(sessions.list.subscribe(observe));
					options.signal?.addEventListener("abort", dispose, { once: true });
					removeOwner = ctx.effect(() => dispose, "user-questions: card surface owner");
					removeGeneration = binding.ctx.effect(() => dispose, "user-questions: card surface generation");
					reconcile();
					observe();
					handedOff = true;
					if (options.signal?.aborted) dispose();
					return {
						sessionId: id,
						requestKey: key,
						...options.callId === void 0 ? {} : { callId: options.callId },
						state,
						View,
						closed: ended.promise,
						dispose
					};
				} catch (error) {
					dispose();
					handedOff = true;
					throw error;
				}
			} finally {
				if (!handedOff) reference.release();
			}
		}
		/** A settlement lease is separate from its view's abort signal and starts synchronously. */
		function runQuestionOperation(ctx, record, send) {
			const sessions = ctx.get("sessions");
			if (sessions === void 0 || sessions.binding(record.pending.sessionId) !== record.binding) return Promise.reject(/* @__PURE__ */ new Error("Question Session generation changed"));
			const reference = sessions.retain(record.pending.sessionId, { source: "controllerOperation" });
			reference.ready.catch(() => {});
			try {
				const snapshot = record.binding.session.getSnapshot();
				if (reference.binding !== record.binding || snapshot.removed || snapshot.openState !== "open") throw new Error("Question Session is unavailable");
				return Promise.resolve(send()).finally(() => {
					reference.release();
				});
			} catch (error) {
				reference.release();
				return Promise.reject(error);
			}
		}
		//#endregion
		//#region C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/core/session/src/surface.ts
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = /* @__PURE__ */ new Set([
			"system/message",
			"developer/message",
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Narrow an event to a surface-eligible event carrying its required marker.
		* @param event - event to test.
		* @returns true when both the type and marker identify a surface event.
		*/
		function isSurfaceEvent(event) {
			if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
			return event.surfaceOp !== void 0;
		}
		/**
		* Narrow an event to an append-origin surface event: one that entered the
		* surface at its own log position and was never itself a replacement copy.
		*
		* The model-visible surface deliberately shadows replaced ranges, so it is the
		* wrong source for a human transcript — a landed replacement would erase
		* conversation the user already saw. Append-origin events are that transcript's
		* durable source material; replacement copies stay model-only.
		* @param event - event to test.
		* @returns true when the event appended to the surface tail.
		*/
		function isAppendSurfaceEvent(event) {
			return isSurfaceEvent(event) && event.surfaceOp === "append";
		}
		//#endregion
		//#region src/client/question-reply.ts
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* Read the question and answer pairs out of the reply text at the conversation boundary.
		* @param text - Model-facing JSON payload of the steered message.
		* @returns The pairs, or empty lists when the payload is unreadable.
		*/
		function replyPairsOf(text) {
			let value;
			try {
				value = JSON.parse(text);
			} catch (error) {
				return {
					questions: [],
					answers: []
				};
			}
			if (!isRecord(value) || !Array.isArray(value.questions)) return {
				questions: [],
				answers: []
			};
			const questions = [];
			for (const question of value.questions) {
				if (!isRecord(question) || typeof question.id !== "string" || typeof question.question !== "string") continue;
				questions.push({
					id: question.id,
					question: question.question,
					...typeof question.detail === "string" ? { detail: question.detail } : {},
					...typeof question.header === "string" ? { header: question.header } : {},
					...Array.isArray(question.options) ? { options: question.options.flatMap((option) => {
						if (!isRecord(option) || typeof option.label !== "string") return [];
						return [{
							label: option.label,
							...typeof option.description === "string" ? { description: option.description } : {}
						}];
					}) } : {},
					...typeof question.multiSelect === "boolean" ? { multiSelect: question.multiSelect } : {}
				});
			}
			const answers = [];
			for (const answer of Array.isArray(value.answers) ? value.answers : []) {
				if (!isRecord(answer) || typeof answer.id !== "string" || !Array.isArray(answer.selected)) continue;
				answers.push({
					id: answer.id,
					selected: answer.selected.filter((item) => typeof item === "string"),
					...typeof answer.custom === "string" ? { custom: answer.custom } : {}
				});
			}
			return {
				questions,
				answers
			};
		}
		/**
		* Answer values of one question in display order: the selected option labels
		* followed by a non-blank custom answer.
		* @param data - Projected reply holding the recorded answers.
		* @param id - Question id to read.
		* @returns The values, empty when the user skipped that question.
		*/
		function replyAnswerValues(data, id) {
			const answer = data.answers.find((item) => item.id === id);
			const custom = answer?.custom?.trim() ?? "";
			return [...answer?.selected ?? [], ...custom === "" ? [] : [custom]];
		}
		/**
		* Clipboard text of one late reply: every question with the answer the user
		* gave, in the layout the open bubble shows, without the options nobody chose.
		* The text does not depend on whether the bubble is open.
		* @param data - Projected reply to copy.
		* @param t - Bound `question` namespace translator owning the answer labels.
		* @returns One block per question, or the model-facing text when the payload was unreadable.
		*/
		function replyClipboardText(data, t) {
			if (data.questions.length === 0) return data.text;
			return data.questions.map((question) => {
				const values = replyAnswerValues(data, question.id);
				return `${question.header && question.header !== question.question ? `${question.header} — ${question.question}` : question.question}\n${values.length === 0 ? t("reply.skipped") : `${t("reply.answerLabel")}${values.join(", ")}`}`;
			}).join("\n\n");
		}
		/** Validate a late reply source at the persisted conversation boundary. */
		function replySource(event) {
			const source = event.data.source;
			return isRecord(source) && source.kind === "user-question-reply" && typeof source.callId === "string" && source.outcome === "answered" ? {
				callId: source.callId,
				outcome: "answered"
			} : null;
		}
		/** Late-reply projection owned by the questions UI. */
		const questionReplyDefinition = {
			kind: "user-question-reply",
			target: "chat",
			match: (event) => {
				if (event.type !== "user/message" || !isAppendSurfaceEvent(event)) return null;
				return replySource(event) === null ? null : {
					id: String(event.data.id),
					role: "start"
				};
			},
			start: (_context, match) => {
				if (match.event.type !== "user/message") throw new Error("user-question-reply start requires user/message");
				const event = match.event;
				const text = event.data.content.find((item) => item.type === "text")?.text ?? "";
				const source = replySource(event);
				if (source === null) throw new Error("user-question-reply start requires a reply source");
				return {
					seq: event.seq,
					time: event.time,
					callId: source.callId,
					outcome: source.outcome,
					text,
					...replyPairsOf(text)
				};
			},
			update: (context) => context.state,
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				const { seq, ...data } = context.state;
				return {
					key: context.key,
					kind: "question-reply",
					id: context.id,
					target: "chat",
					anchorSeq: seq,
					location: context.start?.location ?? { kind: "unresolved" },
					visibility: "visible",
					data
				};
			}
		};
		//#endregion
		//#region \0dsh-css:G:\Projects\dsh-better-tasks\.srcbuild\packages\client\ui-user-questions\src\client\QuestionReplyView.module.css.mjs
		const css = ".R8yz5W_row{flex-direction:column;justify-content:flex-end;align-items:flex-end;gap:6px;padding:4px 0;display:flex}.R8yz5W_bubble{border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-bubble);max-width:72%;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));text-align:left;overflow-wrap:anywhere;white-space:pre-wrap;padding:10px 16px}.R8yz5W_toggle{width:100%;color:inherit;cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;padding:0}.R8yz5W_toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.R8yz5W_bubble:has(.R8yz5W_toggle:focus-visible){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}.R8yz5W_labelRow{align-items:center;gap:3px;display:flex}.R8yz5W_caret{color:var(--dsw-alias-label-secondary);display:inline-flex}.R8yz5W_caret svg{width:12px;height:12px}.R8yz5W_label{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px));display:block}.R8yz5W_summary{color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);margin-top:3px;display:block}.R8yz5W_text{margin:8px 0 0}.R8yz5W_details{border-top:1px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 24%, transparent);margin:8px 0 0;padding-top:8px}.R8yz5W_details>div+div{margin-top:12px}.R8yz5W_details dt{color:var(--dsw-alias-label-secondary);font-size:12px}.R8yz5W_question{gap:3px;display:grid}.R8yz5W_header,.R8yz5W_detail,.R8yz5W_options{color:var(--dsw-alias-label-secondary);font-size:11px}.R8yz5W_questionText{color:var(--dsw-alias-label-primary)}.R8yz5W_options{margin:0;padding-left:16px}.R8yz5W_details dd{margin:4px 0 0}.R8yz5W_answer{font-size:14px}.R8yz5W_answerLabel{color:var(--dsw-alias-label-secondary);margin-right:4px;font-size:12px}.R8yz5W_actions{height:28px;color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;padding-right:4px;display:flex}.R8yz5W_time{white-space:nowrap;padding-right:4px;font-size:13px;line-height:24px}.R8yz5W_action{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:inherit;cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.R8yz5W_action svg{width:15px;height:15px}.R8yz5W_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}";
		const tagId = "@deepseek-ai/dsh-client-ui-user-questions/QuestionReplyView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-user-questions";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var QuestionReplyView_module_css_default = {
			"action": "R8yz5W_action",
			"actions": "R8yz5W_actions",
			"answer": "R8yz5W_answer",
			"answerLabel": "R8yz5W_answerLabel",
			"bubble": "R8yz5W_bubble",
			"caret": "R8yz5W_caret",
			"detail": "R8yz5W_detail",
			"details": "R8yz5W_details",
			"header": "R8yz5W_header",
			"label": "R8yz5W_label",
			"labelRow": "R8yz5W_labelRow",
			"options": "R8yz5W_options",
			"question": "R8yz5W_question",
			"questionText": "R8yz5W_questionText",
			"row": "R8yz5W_row",
			"summary": "R8yz5W_summary",
			"text": "R8yz5W_text",
			"time": "R8yz5W_time",
			"toggle": "R8yz5W_toggle"
		};
		//#endregion
		//#region src/client/QuestionReplyView.tsx
		/**
		* Right-aligned late-reply bubble: a label naming the earlier pending
		* questions, then one question and answer pair per question. A payload the
		* Client cannot read falls back to the model-facing text.
		*/
		const QuestionReplyView = (0, react.memo)(function QuestionReplyView({ node, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuestionReplyBubble, {
				data: node.data,
				t
			});
		});
		/**
		* Render one settled question reply as a compact transcript bubble.
		* @param props - Reply data and the question locale translator.
		* @returns The expandable reply bubble.
		*/
		function QuestionReplyBubble({ data, t }) {
			const label = t("reply.label");
			const [open, setOpen] = (0, react.useState)(false);
			const toggleLabel = t(open ? "reply.close" : "reply.open");
			const summary = data.questions.map((question) => replyAnswerValues(data, question.id)).flat().join(", ");
			const copyText = replyClipboardText(data, t);
			const [copied, setCopied] = (0, react.useState)(false);
			const onCopy = (0, react.useCallback)(() => {
				if (copied) return;
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(copyText).then((ok) => {
					if (!ok) return;
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1e3);
				});
			}, [copied, copyText]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: QuestionReplyView_module_css_default.row,
				"data-question-reply": data.callId,
				"data-reply-outcome": data.outcome,
				role: "group",
				"aria-label": label,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuestionReplyView_module_css_default.bubble,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: QuestionReplyView_module_css_default.toggle,
						"aria-expanded": open,
						"aria-label": `${label} · ${toggleLabel}`,
						onClick: () => {
							setOpen((value) => !value);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: QuestionReplyView_module_css_default.labelRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: QuestionReplyView_module_css_default.caret,
								"aria-hidden": "true",
								children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: QuestionReplyView_module_css_default.label,
								children: label
							})]
						}), !open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuestionReplyView_module_css_default.summary,
							children: summary === "" ? t("reply.skipped") : summary
						})]
					}), open && (data.questions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: QuestionReplyView_module_css_default.text,
						children: data.text
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
						className: QuestionReplyView_module_css_default.details,
						children: data.questions.map((question) => {
							const values = replyAnswerValues(data, question.id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dt", {
								className: QuestionReplyView_module_css_default.question,
								children: [
									question.header && question.header !== question.question && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: QuestionReplyView_module_css_default.header,
										children: question.header
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: QuestionReplyView_module_css_default.questionText,
										children: question.question
									}),
									question.detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: QuestionReplyView_module_css_default.detail,
										children: question.detail
									}),
									question.options && question.options.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: QuestionReplyView_module_css_default.options,
										children: question.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [option.label, option.description && ` — ${option.description}`] }, option.label))
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
								className: QuestionReplyView_module_css_default.answer,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: QuestionReplyView_module_css_default.answerLabel,
									children: t("reply.answerLabel")
								}), values.length === 0 ? t("reply.skipped") : values.join(", ")]
							})] }, question.id);
						})
					}))]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuestionReplyView_module_css_default.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: QuestionReplyView_module_css_default.time,
						children: new Intl.DateTimeFormat(void 0, {
							hour: "2-digit",
							minute: "2-digit",
							hour12: false
						}).format(data.time)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: copied ? t("copied") : t("copy"),
						side: "bottom",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: QuestionReplyView_module_css_default.action,
							"aria-label": copied ? t("copied") : t("copy"),
							onClick: onCopy,
							children: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, {})
						})
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `question` namespace dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"error.incomplete": "请先完成这道问题。",
			"error.unanswered": "请选择一个选项或填写自定义答案。",
			"error.unavailable": "当前无法提交，请稍候再试。",
			"error.resubmit": "回答未送达，工作已继续，请再提交一次。",
			"status.sent": "回答已发送；面板未能关闭。",
			"wait.takeTime": "慢慢回答",
			"wait.countdown": "{seconds} 秒后继续工作",
			"wait.paused": "已暂停 · 剩余 {seconds} 秒",
			"wait.held": "会一直等你回答",
			"wait.continued": "已继续工作，仍可回答",
			"review.status": "已回答",
			"review.skipped": "这道问题当时被跳过。",
			"reply.label": "回答先前等待中的问题",
			"reply.open": "展开问题详情",
			"reply.close": "收起问题详情",
			"reply.answerLabel": "回答：",
			"reply.skipped": "已跳过",
			"nav.prev": "上一题",
			"nav.next": "下一题",
			"nav.minimize": "收起问题卡片",
			"nav.maximize": "展开问题卡片",
			"nav.cancel": "放弃整组问题",
			"nav.close": "收起问题面板，可从工具调用重新打开",
			"option.recommended": "推荐",
			"custom.placeholder": "输入你的答案",
			"action.skip": "跳过",
			"action.next": "下一题",
			"plan.header": "计划待审",
			"plan.approve": "同意执行",
			"plan.decline": "拒绝",
			"plan.discuss": "要求修改"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"error.incomplete": "Please complete this question first.",
			"error.unanswered": "Please select an option or enter a custom answer.",
			"error.unavailable": "Cannot submit right now; try again in a moment.",
			"error.resubmit": "The answer did not arrive before work continued; submit it again.",
			"status.sent": "Reply sent; the panel could not close.",
			"wait.takeTime": "Take time",
			"wait.countdown": "Continuing in {seconds}s",
			"wait.paused": "Paused · {seconds}s remaining",
			"wait.held": "Waiting until you answer",
			"wait.continued": "Work continued — you can still answer",
			"review.status": "Answered",
			"review.skipped": "This question was skipped.",
			"reply.label": "Reply to earlier pending questions",
			"reply.open": "Open question details",
			"reply.close": "Close question details",
			"reply.answerLabel": "Answer: ",
			"reply.skipped": "Skipped",
			"nav.prev": "Previous question",
			"nav.next": "Next question",
			"nav.minimize": "Collapse the question card",
			"nav.maximize": "Expand the question card",
			"nav.cancel": "Dismiss all questions",
			"nav.close": "Close the panel — reopen it from the tool call",
			"option.recommended": "Recommended",
			"custom.placeholder": "Type your answer",
			"action.skip": "Skip",
			"action.next": "Next",
			"plan.header": "Plan review",
			"plan.approve": "Approve",
			"plan.decline": "Refuse",
			"plan.discuss": "Request changes"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "question";
		/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, conversation nodes, and copy. */
		const inject = [
			"sessions",
			"remote",
			"remote.userQuestions",
			"uiSession",
			"slots",
			"locale",
			"uiConversation"
		];
		/**
		* Cards published to the Session pending-interaction registry, keyed by
		* `PendingQuestion.key`. A tool-call-keyed card is shared by the forwarded
		* waterfall and the Session projection.
		*
		* A card outlives its seat. Closing the panel only unpublishes it, which keeps
		* the request answerable from its tool call row, so this registry — not the
		* pending-interaction registry — decides when a request is over.
		*/
		var QuestionCards = class {
			publish;
			removed;
			#cards = /* @__PURE__ */ new Map();
			#listeners = /* @__PURE__ */ new Map();
			constructor(publish, removed) {
				this.publish = publish;
				this.removed = removed;
			}
			subscribe(key, listener) {
				const listeners = this.#listeners.get(key) ?? /* @__PURE__ */ new Set();
				listeners.add(listener);
				this.#listeners.set(key, listeners);
				return () => {
					listeners.delete(listener);
					if (listeners.size === 0) this.#listeners.delete(key);
				};
			}
			#notify(key) {
				for (const listener of [...this.#listeners.get(key) ?? []]) listener();
			}
			byCallId(sessionId, callId) {
				return this.#cards.get(PendingQuestion.keyOf(sessionId, callId));
			}
			/** Observable state for one card while the registry owns it. */
			source(key) {
				return this.#cards.get(key)?.pending;
			}
			values() {
				return [...this.#cards.values()];
			}
			/** Keys of every card registered for one Session. */
			keysFor(sessionId) {
				return this.values().filter((card) => card.pending.sessionId === sessionId).map((card) => card.pending.key);
			}
			/**
			* Return the card of a tool call, creating and publishing it when absent.
			* A request without a call id always gets a fresh card.
			*/
			ensure(sessionId, questions, callId) {
				if (callId !== void 0) {
					const existing = this.byCallId(sessionId, callId);
					if (existing !== void 0) return existing;
				}
				return this.#create(new PendingQuestion(sessionId, questions, callId, () => this.keysFor(sessionId)));
			}
			/** Publish one carrier into the composer seat and register the card that owns it. */
			#create(pending) {
				const requests = /* @__PURE__ */ new Set();
				const delegate = async () => {
					pending.delegate();
					await Promise.all(requests);
				};
				let unpublish = this.publish(pending, delegate);
				const card = {
					pending,
					hide: () => {
						unpublish?.();
						unpublish = void 0;
					},
					reveal: () => {
						unpublish?.();
						unpublish = this.publish(pending, delegate);
					},
					remove: () => {
						/* v8 ignore next -- a card leaves the registry once; no caller holds a card the registry already replaced. */
						if (this.#cards.get(pending.key) !== card) return;
						this.#cards.delete(pending.key);
						pending.close();
						this.removed(pending);
						unpublish?.();
						unpublish = void 0;
						this.#notify(pending.key);
					},
					trackRequest: (completion) => {
						requests.add(completion);
						return () => {
							requests.delete(completion);
						};
					},
					hasRequest: () => requests.size > 0
				};
				pending.attachSeat({ hide: pending.review === void 0 ? card.hide : card.remove });
				this.#cards.set(pending.key, card);
				this.#notify(pending.key);
				return card;
			}
			/**
			* Show the panel of one answerable tool call.
			* @param sessionId - Session the tool call belongs to.
			* @param callId - `ask_user_question` call whose panel to show, as its
			* transcript row spells it.
			* @returns whether a card for that call is still answerable.
			*/
			reveal(sessionId, callId) {
				const card = this.byCallId(sessionId, callId);
				if (card === void 0) return false;
				card.reveal();
				return true;
			}
			/**
			* Show one settled tool call's recorded answers as a read-only card. A call
			* that somehow still holds a card is shown as it stands, so a live request is
			* never replaced by a stale copy of itself.
			* @param sessionId - Session the tool call belongs to.
			* @param callId - `ask_user_question` call whose record to show, as its
			* transcript row spells it.
			* @param record - the call's questions and recorded answers.
			* @returns true; a record always produces a card.
			*/
			review(sessionId, callId, record) {
				(this.byCallId(sessionId, callId) ?? this.#create(new PendingQuestion(sessionId, record.questions, brandString(callId), () => this.keysFor(sessionId), record.answers))).reveal();
				return true;
			}
			/**
			* Hand every live waterfall back at plugin teardown. The pending-interaction
			* registry only drains what it currently holds, and a hidden card is not in
			* it, so its Host request would wait for its own abort instead.
			*/
			dispose() {
				for (const card of this.values()) {
					card.pending.delegate();
					card.remove();
				}
			}
		};
		/** Present one forwarded request through its card until the waterfall settles. */
		async function answerQuestion(ctx, owner, request, next, cards) {
			const sessionId = ctx.sessions.scopeOf(owner);
			if (sessionId === void 0) return next();
			const callId = request.wait?.callId;
			const card = cards.ensure(sessionId, request.questions, callId);
			const claimLifetime = new AbortController();
			const claimSignal = request.signal === void 0 ? claimLifetime.signal : AbortSignal.any([claimLifetime.signal, request.signal]);
			let claim;
			let claimEnded;
			let delegateRequest;
			const releaseClaim = request.wait?.timed === true && callId !== void 0 ? ctx.effect(() => {
				claim = ctx.remote.userQuestions.attachWait(sessionId, callId, claimSignal);
				return async () => {
					delegateRequest?.();
					claimLifetime.abort();
					claim?.dispose();
					if (claimEnded !== void 0) await Promise.allSettled([claimEnded]);
				};
			}, "ui-user-questions: foreground claim") : void 0;
			const completed = Promise.withResolvers();
			const finishRequest = card.trackRequest(completed.promise);
			try {
				const iterator = claim?.[Symbol.asyncIterator]();
				const opening = iterator === void 0 ? void 0 : await iterator.next();
				if (opening?.done === true) return await next();
				const waterfall = createWaterfallRequest(opening === void 0 ? void 0 : Date.now() + opening.value.remainingMs, claimSignal, (channel) => {
					card.pending.detachWaterfall(channel);
				});
				if (claimSignal.aborted) return await waterfall.result;
				delegateRequest = () => {
					waterfall.channel.delegate();
				};
				card.pending.attachWaterfall(waterfall.channel);
				if (iterator !== void 0) claimEnded = (async () => {
					await iterator.next();
					throw new Error("the foreground question wait ended");
				})();
				try {
					return await (claimEnded === void 0 ? waterfall.result : Promise.race([waterfall.result, claimEnded]));
				} catch (error) {
					if (waterfall.isDelegation(error)) {
						await releaseClaim?.();
						return await next();
					}
					throw error;
				}
			} finally {
				if (releaseClaim === void 0) claimLifetime.abort();
				else if (claimEnded === void 0) await releaseClaim();
				else Promise.allSettled([claimEnded]).then(() => {
					releaseClaim();
				});
				if (callId === void 0) card.remove();
				completed.resolve();
				finishRequest();
			}
		}
		/**
		* Mirror answerable calls onto cards. A submitted reply in the durable Inbox
		* removes the editable card until the reply is admitted or discarded.
		*/
		function publishContinuedQuestions(ctx, cards) {
			const sessions = ctx.sessions;
			const stopProjections = /* @__PURE__ */ new Map();
			const unwrap = (result) => {
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			};
			const rpcFor = (sessionId, callId) => ({ answer: async (answer) => unwrap(await ctx.remote.userQuestions.answer(sessionId, callId, answer)) });
			const reconcile = () => {
				const snapshot = sessions.list.getSnapshot();
				const bound = new Map(Object.values(snapshot.byId).flatMap((summary) => {
					const binding = sessions.binding(summary.id);
					return binding === void 0 ? [] : [[summary.id, binding]];
				}));
				for (const [sessionId, entry] of stopProjections) {
					if (bound.get(sessionId) === entry.binding) continue;
					entry.stop();
					stopProjections.delete(sessionId);
				}
				for (const [sessionId, binding] of bound) {
					if (stopProjections.has(sessionId)) continue;
					const stopQuestions = binding.session.projections.faceOf("userQuestions").subscribe(reconcile);
					const stopInbox = binding.session.projections.faceOf("inbox").subscribe(reconcile);
					stopProjections.set(sessionId, {
						binding,
						stop: () => {
							stopQuestions();
							stopInbox();
						}
					});
				}
				const rows = /* @__PURE__ */ new Map();
				for (const [sessionId, binding] of bound) {
					const projected = binding.session.projections.faceOf("userQuestions").getSnapshot();
					const queued = queuedQuestionReplies(binding.session.projections.faceOf("inbox").getSnapshot());
					for (const row of projected?.active ?? []) {
						if (row.state === "continued" && queued.has(row.callId)) continue;
						rows.set(PendingQuestion.keyOf(sessionId, row.callId), {
							sessionId,
							row
						});
					}
				}
				for (const { sessionId, row } of rows.values()) {
					if (row.state === "continued") {
						const card = cards.ensure(sessionId, row.questions, row.callId);
						card.pending.attachRpc(rpcFor(sessionId, row.callId));
						card.pending.setState("continued");
						continue;
					}
					cards.byCallId(sessionId, row.callId)?.pending.setState("open");
				}
				for (const card of cards.values()) {
					if (card.pending.callId === void 0 || card.pending.review !== void 0 || rows.has(card.pending.key) || card.hasRequest() || card.pending.hasWaterfall()) continue;
					card.remove();
				}
			};
			reconcile();
			const stopList = sessions.list.subscribe(reconcile);
			return {
				reconcile,
				dispose: () => {
					stopList();
					for (const entry of stopProjections.values()) entry.stop();
					stopProjections.clear();
				}
			};
		}
		/**
		* Task-card presentation for a host-mounted surface. Scoped by the
		* `data-question-surface` discriminator so it cannot reach the composer seat,
		* and built from this package's own class maps so a CSS-module hash change
		* cannot silently detach it.
		* @returns the stylesheet text for the `task-card` variant.
		*/
		function taskCardCss() {
			const c = QuestionComposer_module_css_default;
			const r = PlanReviewPanel_module_css_default;
			const scope = "[data-question-surface=\"task-card\"]";
			const font = "var(--dsh-question-card-font-size,var(--dbt-projection-font-size,13px))";
			return [
				`${scope}{min-width:0;max-width:100%;overflow:hidden;font-size:${font};line-height:1.5}`,
				`${scope} .${c.frame},${scope} .${r.frame}{display:block;padding:4px 0 0}`,
				`${scope} .${c.card},${scope} .${r.card}{width:100%;min-width:0;max-width:none;max-height:min(55vh,420px);border-radius:10px;box-shadow:none}`,
				`${scope} .${c.header}{gap:6px;flex-wrap:wrap;padding:9px 8px 6px 10px}`,
				`${scope} .${c.headerActions}{min-width:0;flex-wrap:wrap}`,
				`${scope} .${c.title}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
				`${scope} .${c.body}{min-width:0;padding:8px 10px 2px;font-size:${font};line-height:1.5}`,
				`${scope} .${c.footer},${scope} .${r.footer}{min-width:0;flex-wrap:wrap;gap:7px;padding:7px 10px 9px}`,
				`${scope} .${c.footerActions},${scope} .${r.actions}{min-width:0;flex-wrap:wrap}`,
				`${scope} .${c.footerActions}{gap:6px}`,
				`${scope} .${c.footerActions} button{height:auto;min-height:28px;padding:4px 9px;font-size:${font};line-height:1.5}`,
				`${scope} button,${scope} textarea{font-family:inherit;font-size:inherit;line-height:inherit}`,
				`${scope} .${c.option}{min-width:0;padding:8px 9px;font-size:${font};line-height:1.5}`,
				`${scope} .${c.optionLabel}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
				`${scope} .${c.description}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
				`${scope} .${c.fieldMirror},${scope} .${c.fieldInput}{font-size:${font};line-height:1.5}`,
				`${scope} .${c.eyebrow},${scope} .${c.progress},${scope} .${c.feedback},${scope} .${c.waitStatus},${scope} .${c.badge}{font-size:${font};line-height:1.5;white-space:normal}`,
				`${scope} .${c.number}{font-size:${font};line-height:1.2;flex:0 0 1.5em;min-width:20px;width:1.5em;height:1.5em;margin-top:0}`,
				`${scope} .${c.waitButton}{font-size:${font};line-height:1.5;height:auto;min-height:28px;padding:4px 9px}`
			].join("");
		}
		/**
		* Client plugin body: register the `question` dictionaries, the question
		* composer into the composer chain, and the late-reply conversation node.
		* Zero business face — data and verbs live on the matched carrier; t rides
		* the standard locale seat.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-user-questions: dictionaries");
			const cards = new QuestionCards(ctx.uiSession.registerPendingInteraction((pending) => pending.kind === "plan-review" ? 2 : 1), (pending) => {
				registry.forget(pending);
			});
			ctx.effect(() => () => {
				cards.dispose();
			}, "ui-user-questions: cards");
			const t = ctx.locale.bind(NS);
			const registry = new QuestionSurfaceRegistry({
				isCurrent: (pending) => cards.source(pending.key) === pending,
				bindingOf: (sessionId) => ctx.sessions.binding(sessionId),
				runOperation: (record, send) => runQuestionOperation(ctx, record, send),
				resubmitMessage: () => t("error.resubmit")
			});
			const continuation = publishContinuedQuestions(ctx, cards);
			ctx.effect(() => continuation.dispose, "ui-user-questions: continued questions");
			const supported = (pending) => pending instanceof PendingQuestion && pending.kind === "question" && pending.review === void 0 && !pending.snapshot().closed && cards.source(pending.key) === pending && ctx.sessions.binding(pending.sessionId) !== void 0;
			const questionSurface = Object.freeze({
				find: (sessionId) => findQuestionCard(ctx, cards, sessionId),
				createCard: (options) => createQuestionCard(ctx, cards, registry, continuation.reconcile, options, t),
				isSupported: supported,
				render: (pending, variant = "task-card") => supported(pending) ? (0, react.createElement)(QuestionSurface, {
					pending,
					registry,
					variant,
					store: registry.storeFor(pending.sessionId),
					t,
					useQuestionCard: createQuestionCardHook(pending),
					renderSlot: () => null,
					isAvailable: () => supported(pending)
				}) : null
			});
			ctx.effect(() => {
				const dispose = ctx.reflect.provide("questionSurface", questionSurface);
				return () => {
					dispose();
					registry.dispose();
				};
			}, "ui-user-questions: shared surface");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "@deepseek-ai/dsh-client-ui-user-questions";
				style.dataset.pluginCss = "@deepseek-ai/dsh-client-ui-user-questions/task-card";
				style.textContent = taskCardCss();
				document.head.appendChild(style);
				return () => style.remove();
			}, "ui-user-questions: task-card styles");
			const disposePanels = ctx.reflect.provide("userQuestionPanels", {
				reveal: (sessionId, callId) => cards.reveal(sessionId, callId),
				review: (sessionId, callId, record) => cards.review(sessionId, callId, record)
			});
			ctx.effect(() => disposePanels, "ui-user-questions: answer panels");
			const registeredComposer = (props) => (0, react.createElement)(QuestionComposer, {
				...props,
				registry
			});
			ctx.slots.inject("conversation.composer", () => ctx.slots.register({
				name: "conversation.composer",
				select: ({ pendingInteraction }) => pendingInteraction instanceof PendingQuestion ? pendingInteraction : null,
				locale: NS,
				store: registry.draftStore,
				inject: () => ({ keyedHooks: { questionCard: (key) => cards.source(key) } }),
				children: { "conversation.plan-review.actions": {
					kind: "list",
					scope: "session"
				} }
			}, withRegionBoundary("conversation.composer", registeredComposer)));
			ctx.uiConversation.events.register(questionReplyDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "question-reply",
				locale: NS
			}, QuestionReplyView));
			ctx.remote.$on("user-questions/request", function(request, next) {
				return answerQuestion(ctx, this, request, next, cards);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map