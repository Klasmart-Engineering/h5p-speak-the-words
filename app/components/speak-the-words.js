import React from 'react';
import ReactDOM from 'react-dom';
import './styles/speak-the-words.css';
import 'annyang';
import { decode } from 'he';

import SpeechEngine from './body/speech-engine';
import RecordButton from './body/record-button';
import ShowSolution from './body/show-solution';
import Util from './speak-the-words-util';

/**
 * Speak the words
 * Wraps the whole content type and keeps track of rendering the main components
 * used within the task.
 */
export default class {

  /**
   * @typedef {Object} SpeakTheWordsParameters
   *
   * @property {SpeakTheWordsTranslations} l10n Translation strings
   * @property {string} question Question text
   * @property {Array} acceptedAnswers All accepted spoken answers as specified by the author
   * @property {string} incorrectAnswerText Text for saying the an answer was incorrect
   * @property {string} correctAnswerText Text labeling the correct answers
   * @property {string} inputLanguage Language that input is expected as
   */

  /**
   * @typedef {Object} SpeakTheWordsTranslations
   *
   * @property {string} correctAnswerText Text for saying the an answer was correct
   * @property {string} retryLabel Label for 'retry'-button
   * @property {string} showSolutionLabel Label for 'show solution'-button
   * @property {Array} acceptedAnswers Accepted answers by the speech engine
   * @property {string} listeningLabel Button label when listening for speech
   * @property {string} speakLabel Button label for activating listening for speech
   * @property {string} unsupportedBrowserHeader
   * Header text explaining that a browser is unsupported
   * @property {string} unsupportedBrowserDetails
   * Text with complementary details for unsupported browsers
   * @property {string} userAnswersText Text labeling the users answers
   */

  /**
   * Initialize the main components used within the task
   *
   * @param {SpeakTheWordsParameters} params Author specified parameters
   * @param {Object} question H5P Question instance with button and event functionality
   * @param {object} extras Extra parameters like previous state.
   */
  constructor(params, question, extras) {
    // Set defaults
    this.params = Util.extend({
      question: '',
      acceptedAnswers: [],
      incorrectAnswerText: 'Incorrect answer',
      correctAnswerText: 'Correct answer',
      inputLanguage: 'en-US',
      l10n: {
        retryLabel: 'Retry',
        showSolutionLabel: 'Show solution',
        speakLabel: 'Push to speak',
        listeningLabel: 'Listening...',
        correctAnswersText: 'The correct answer(s):',
        userAnswersText: 'Your answer(s) was interpreted as:',
        noSound: 'I could not hear you, make sure your microphone is enabled',
        unsupportedBrowserHeader: 'It looks like your browser does not support speech recognition',
        unsupportedBrowserDetails: 'Please try again in a browser like Chrome',
        acceptedAnswers: 'Accepted answers: @answers',
        a11yShowSolution: 'Show the solution. The task will be marked with its correct solution.',
        a11yRetry: 'Retry the task. Reset all responses and start the task over again.'
      }
    }, params);

    /** @constant {string[]} view state names*/
    this.VIEW_STATES = ['task', 'results', 'solutions'];

    this.previousState = (extras && extras.previousState) ?
      extras.previousState :
      {};


    this.params.acceptedAnswers = this.params.acceptedAnswers.map(decode);

    this.mediaRecorder = null;
    this.mediaChunks = [];

    this.question = question;
    this.hasAnswered = false;
    this.score = 0;

    this.setViewState(this.previousState.vieState || 'task');

    // Skip rendering components if speech engine does not exist
    if (!window.annyang) {
      return;
    }

    this.speechEventStore = new H5P.EventDispatcher();
    this.createIntroduction(this.params.question);
    this.createContent(this.params);
    this.createButtonBar(this.params.l10n);

    this.handleAnswered = this.handleAnswered.bind(this);

    // Renders record button and show solution area into the question main content
    ReactDOM.render((
      <div>
        <RecordButton
          eventStore={this.speechEventStore}
          l10n={this.params.l10n}
          speechEngine={this.speechEngine}
        />
        <ShowSolution eventStore={this.speechEventStore} {...this.params} />
      </div>
    ), this.questionWrapper);

    this.speechEngine = new SpeechEngine(this.params, this.speechEventStore);
    this.speechEventStore.on('answered-correctly', this.handleAnswered);
    this.speechEventStore.on('answered-wrong', this.handleAnswered);
  }

  /**
   * Create introduction text element
   *
   * @param {string} text Introduction text
   */
  createIntroduction(text) {
    const introduction = document.createElement('div');
    introduction.className = 'h5p-speak-the-words-introduction';
    introduction.textContent = decode(text);
    this.introduction = introduction;
  }

  /**
   * Create content element
   */
  createContent() {
    const questionWrapper = document.createElement('div');
    questionWrapper.className = 'h5p-speak-the-words';
    this.questionWrapper = questionWrapper;
  }

  /**
   * Create button bar
   *
   * @param {Object} l10n Translations
   */
  createButtonBar(l10n) {
    this.question.addButton('try-again', decode(l10n.retryLabel), () => {
      this.resetTask();
    }, false, {
      'aria-label': l10n.a11yRetry,
    });

    this.question.addButton('show-solution', decode(l10n.showSolutionLabel), () => {
      this.showSolutions();
    }, false, {
      'aria-label': l10n.a11yShowSolution,
    });
  }

  /**
   * Handle answered.
   * @param {event} event Annyang result event.
   */
  handleAnswered(event) {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.questionWrapper.parentNode.classList.add('empty');
    if (this.questionWrapper.parentNode.parentNode) {
      this.questionWrapper.parentNode.parentNode.classList.add('answered');
    }

    const response = event.data[0];
    this.lastInterpretations = event.data;
    const correct = this.params.acceptedAnswers.indexOf(response) !== -1;

    let answerText = '';
    if (correct) {
      this.score = 1;
      answerText = this.params.correctAnswerText;
      this.question.hideButton('try-again');
      this.question.hideButton('show-solution');
    }
    else {
      this.score = 0;
      answerText = this.params.incorrectAnswerText;
      this.question.showButton('try-again');
      this.question.showButton('show-solution');
    }

    this.question.setFeedback(decode(answerText), this.getScore(), this.getMaxScore());

    if (!this.previousState.viewState || this.previousState.viewState === 'task') {
      this.triggerXAPIAnswered(response);
    }
    this.hasAnswered = true;

    this.setViewState('results');
  }

  /**
   * Makes sure all the required sections of H5P.Question is rendered.
   * Displays unsupported browser section if the browser does not support the Web Speech API.
   */
  registerDomElements() {
    if (!window.annyang) {
      const errorElement = document.createElement('div');

      // Renders record button and show solution area into the question main content
      ReactDOM.render((
        <div className='h5p-speak-the-words-unsupported-browser-error'>
          <div className='h5p-speak-the-words-unsupported-browser-header'>
            {decode(this.params.l10n.unsupportedBrowserHeader)}
          </div>
          <div className='h5p-speak-the-words-unsupported-browser-body'>
            {decode(this.params.l10n.unsupportedBrowserDetails)}
          </div>
        </div>
      ), errorElement);


      this.question.setIntroduction(errorElement);
      return;
    }

    this.mediaMIMEType = this.getRecordingMIMEType();

    if (this.mediaMIMEType) {
      navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
        // Provide audio for export
        this.mediaRecorder = new MediaRecorder(stream);

        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.mediaChunks, { type: this.mediaMIMEType });
          this.mediaChunks = [];

          if (H5P.KLFileExporter) {
            H5P.KLFileExporter.triggerFileExport(
              this,
              { type: this.mediaMIMEType, blob: blob }
            );
          }
        }

        this.mediaRecorder.ondataavailable = (event) => {
          this.mediaChunks.push(event.data);
        }

        this.speechEventStore.on('start-listening', () => {
          if (this.mediaRecorder.state !== 'recording') {
            this.mediaRecorder.start();
          }
        });
      })
    }

    this.question.setIntroduction(this.introduction);
    this.question.setContent(this.questionWrapper);

    if (this.previousState.lastInterpretations && this.previousState.lastInterpretations.length) {
      this.recreateState();
    }
  }

  /**
   * Recreate state.
   */
  recreateState() {
    const wasCorrect = this.params.acceptedAnswers.indexOf(this.previousState.lastInterpretations[0]) !== -1;

    if (this.previousState.viewState === 'results' || this.previousState.viewState === 'solutions') {
      if (wasCorrect) {
        this.speechEventStore.trigger('answered-correctly', this.previousState.lastInterpretations);
      }
      else {
        this.speechEventStore.trigger('answered-wrong', this.previousState.lastInterpretations);
      }
    }

    if (this.previousState.viewState === 'solutions') {
      this.showSolutions();
    }

    this.speechEventStore.trigger('resize');
  }

  /**
   * Resets question.
   */
  resetTask() {
    this.questionWrapper.parentNode.classList.remove('empty');
    if (this.questionWrapper.parentNode.parentNode) {
      this.questionWrapper.parentNode.parentNode.classList.remove('answered', 'showing-solution');
    }
    this.question.hideButton('try-again');
    this.question.hideButton('show-solution');
    this.question.removeFeedback();
    this.speechEventStore.trigger('reset-task');
    this.hasAnswered = false;
    this.score = 0;
    this.question.trigger('reset-task');

    this.previousState = {};
    this.lastInterpretations = [];
    this.setViewState('task');
  }

  /**
   * Show solutions
   */
  showSolutions() {
    this.questionWrapper.parentNode.classList.remove('empty');
    if (this.questionWrapper.parentNode.parentNode) {
      this.questionWrapper.parentNode.parentNode.classList.add('showing-solution');
    }
    this.question.hideButton('show-solution');
    this.speechEventStore.trigger('show-solution');

    this.setViewState('solutions');
  }

  /**
   * Force stop listening for voice input.
   */
  stopListening() {
    this.speechEventStore.trigger('stop-all-media');
  }

  /**
   * Get current score.
   */
  getScore() {
    return this.score;
  }

  /**
   * Get maximum score.
   * @return {number} Maximum score.
   */
  getMaxScore() {
    return 1;
  }

  /**
   * Check if question is answered.
   * @returns {boolean}
   */
  isQuestionAnswered() {
    return this.hasAnswered;
  }

  /**
   * Trigger xAPI answered statement.
   * @param {string} response Response that was detected.
   */
  triggerXAPIAnswered(response) {
    const xAPIEvent = this.getXAPIAnswerEvent(this.question);

    // Add response to result
    xAPIEvent.data.statement.result.response = response;

    this.question.trigger(xAPIEvent)
  }

  /**
   * Get xAPI data.
   * @param {object} wrapper H5P instance.
   * @return {object} XAPI statement.
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-6}
   */
  getXAPIData(wrapper) {
    return ({
      statement: this.getXAPIAnswerEvent(wrapper).data.statement
    });
  }

  /**
   * Build xAPI answer event.
   * @param {object} wrapper H5P instance.
   * @return {H5P.XAPIEvent} XAPI answer event.
   */
  getXAPIAnswerEvent(wrapper) {
    const xAPIEvent = this.createXAPIEvent('answered', wrapper);

    xAPIEvent.setScoredResult(this.getScore(), this.getMaxScore(), wrapper,
      true, this.getScore() === this.getMaxScore());

    return xAPIEvent;
  }

  /**
   * Create an xAPI event for SpeakTheWords.
   * @param {string} verb Short id of the verb we want to trigger.
   * @param {object} wrapper H5P instance.
   * @return {H5P.XAPIEvent} Event template.
   */
  createXAPIEvent(verb, wrapper = {}) {

    const xAPIEvent = new H5P.XAPIEvent();

    xAPIEvent.setActor();
    xAPIEvent.setVerb(verb);
    xAPIEvent.setObject(wrapper);
    xAPIEvent.setContext(wrapper);

    Util.extend(
      xAPIEvent.getVerifiedStatementValue(['object', 'definition']),
      this.getxAPIDefinition());
    return xAPIEvent;
  }

  /**
   * Get the xAPI definition for the xAPI object.
   * @return {object} XAPI definition.
   */
  getxAPIDefinition() {
    return ({
      name: {'en-US': H5P.createTitle('Speak the Words')},
      description: {'en-US': this.params.question},
      type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
      interactionType: 'fill-in',
      correctResponsesPattern: this.params.acceptedAnswers
    });
  }

  /**
   * Get MIME type for recording.
   * @return {string|null} MIME type or null.
   */
  getRecordingMIMEType() {
    if (!window.MediaRecorder) {
      return null;
    }

    if (!window.MediaRecorder.isTypeSupported) {
      // Best guess: older Apple device not yet supporting that function but recording in general
      return 'audio/mp4';
    }

    if (window.MediaRecorder.isTypeSupported('audio/webm')) {
      return 'audio/webm';
    }

    if (window.MediaRecorder.isTypeSupported('audio/mp4')) {
      // Exception for Apple devices that only record mp4
      return 'audio/mp4';
    }

    return null;
  }

  /**
   * Get current state.
   * @return {object} Current state.
   */
  getCurrentState() {
    const state = {
      viewState: this.viewState,
      lastInterpretations: this.lastInterpretations || []
    };

    return state;
  }

  /**
   * Set view state.
   * @param {string} state View state.
   */
  setViewState(state) {
    if (this.VIEW_STATES.indexOf(state) === -1) {
      return;
    }

    // Kidsloop Live session storage will listen
    this.question.trigger('kllStoreSessionState', undefined, { bubbles: true, external: true });

    this.viewState = state;
  }
}
