import * as _ from 'lodash';
import { Dictionary } from 'lodash';

import { WorldDimensions, State, Vector, Person, World, worldDimensions, interactionRange, Statistics } from '../common/common';
import { randomUpTo, randomOfMagnitude } from '../common/random';
import { StateMachine, TransitionsFromState, RandomTransitionToState, ForcedTransitionToState } from '../common/state.machine';

const infectedShareAtStart = 0.01;
const timeTicksPerDay = 50;

/*
 * Some of the state transitions happen by themselves following certain probabilities. And some are forced by other PersonSimulations: Healthy -> Exposed
 */
const knownStateTransitions = new StateMachine({
  [State.Healthy]: new TransitionsFromState(State.Healthy, [], [new ForcedTransitionToState(State.Exposed)]),
  [State.Exposed]: new TransitionsFromState(State.Exposed, [new RandomTransitionToState(State.Infected, 0.50, 0), new RandomTransitionToState(State.Healthy, 0.50, 0)]),
  [State.Infected]: new TransitionsFromState(State.Infected, [new RandomTransitionToState(State.Contagious, 1.0, 2)]),
  [State.Contagious]: new TransitionsFromState(State.Contagious, [new RandomTransitionToState(State.Accute, 0.2, 2), new RandomTransitionToState(State.Immune, 0.8, 14)]),
  [State.Accute]: new TransitionsFromState(State.Accute, [new RandomTransitionToState(State.Immune, 0.75, 14), new RandomTransitionToState(State.IntensiveCare, 0.25, 2)]),
  [State.IntensiveCare]: new TransitionsFromState(State.IntensiveCare, [new RandomTransitionToState(State.Immune, 0.5, 14), new RandomTransitionToState(State.Dead, 0.5, 14)]),
  [State.Immune]: new TransitionsFromState(State.Immune, [new RandomTransitionToState(State.Healthy, 1.0, 365)]),
  [State.Dead]: new TransitionsFromState(State.Dead, [])
});

//TODO: Extract to random.js
function hasOcurred(probability: number): boolean {
  return Math.random() <= probability;
}

//TODO: Make a method on the vector itself?
function distance(vector: Vector, otherVector: Vector) {
  return Math.sqrt(Math.pow(vector.x - otherVector.x, 2) + Math.pow(vector.y - otherVector.y, 2));
}

class PersonSimulation {
  static zeroSpeed = new Vector(0, 0);

  id: number
  worldDimensions: WorldDimensions

  state: State
  position: Vector

  speed: Vector

  //TODO: Should there just be a separate boolean field "isImmobile" for the PersonSimulation?
  savedSpeed: Vector
  nextState: State

  //TODO: Better to keep this information somewhere in the stats computation? Logically belongs to stats calcultion
  wasInfected: boolean

  timeTicksSinceTransitionStarted: number
  timeTicksToCompleteTransition: number

  constructor(id: number, worldDimensions: WorldDimensions, position: Vector, speed: Vector, state: State) {
    this.id = id;
    this.position = position;
    this.worldDimensions = worldDimensions;
    this.speed = speed;

    this.state = state;
    this.wasInfected = state === State.Infected;
    this.timeTicksSinceTransitionStarted = 0;
    this.timeTicksToCompleteTransition = 0;
    this.nextState = null;
  }

  move() {
    if (this.position.x >= this.worldDimensions.width || this.position.x <= 0) {
      this.speed.x = - this.speed.x;
    }
    if (this.position.y >= this.worldDimensions.height || this.position.y <= 0) {
      this.speed.y = - this.speed.y;
    }
    this.position.x = this.position.x + this.speed.x * timeStep;
    this.position.y = this.position.y + this.speed.y * timeStep;
  }

  //TODO: Should the process of transitioning to a new state be extracted as a separate class/entity from PersonSimulation?
  handleAutoStateTransitions() {
    if (this.nextState !== null && this.state !== this.nextState) {
      this.timeTicksSinceTransitionStarted = this.timeTicksSinceTransitionStarted + 1;
      if (this.timeTicksSinceTransitionStarted >= this.timeTicksToCompleteTransition) {
        const fromState = this.state;
        this.state = this.nextState;
        this.nextState = null;
        this.onTransitionToStateFinished(fromState, this.state);
        this.determineAndStartTransitionToNewState();
      }
    } else {
      this.determineAndStartTransitionToNewState();
    }
  }

  update() {
    this.move();
    this.handleAutoStateTransitions();
  }

  onEncounterWith(other: PersonSimulation) {
    if (other.state === State.Contagious && this.state === State.Healthy) {
      this.state = State.Exposed;
    }
  }

  onTransitionToStateFinished(from: State, to: State) {
    if (from == State.Contagious && to == State.Accute) {
      this.savedSpeed = this.speed;
      this.speed = PersonSimulation.zeroSpeed;
    } else if ((from == State.Accute && to == State.Immune) || (from == State.IntensiveCare && to == State.Immune)) {
      this.speed = this.savedSpeed;
      this.savedSpeed = null;
    } else if ((from == State.Exposed) && (to == State.Infected)) {
      this.wasInfected = true;
    }
  }

  determineAndStartTransitionToNewState() {
    const nextStateAndTransitionDuration = knownStateTransitions.nextState(this.state);
    if (nextStateAndTransitionDuration) {
      const [nextState, timeToCompleteTransition] = nextStateAndTransitionDuration;
      this.nextState = nextState;
      this.timeTicksSinceTransitionStarted = 0;
      this.timeTicksToCompleteTransition = timeToCompleteTransition * timeTicksPerDay;
    }
  }

  getPerson(): Person {
    return new Person(this.id, this.position, this.state);
  }
}

const timeStep = 1;
const maxSpeed = 5;

const sectionsNumber = 5;

class WorldSimulation {
  interval: NodeJS.Timeout;
  populationSize: number;
  timeTicksElapsed: number;
  statistics!: Statistics;
  personSimulations: Array<PersonSimulation>;
  constructor(public readonly dimensions: WorldDimensions) {
    this.timeTicksElapsed = 0;
    this.statistics = new Statistics();
  }

  populate(populationSize: number) {
    this.populationSize = populationSize;
    this.personSimulations = [];

    //TODO: Should creating an individual simulation be a method on PersonSimulation?
    for (let i = 0; i < populationSize; i++) {
      const position = new Vector(randomUpTo(this.dimensions.width), randomUpTo(this.dimensions.height));
      const speed = new Vector(randomOfMagnitude(maxSpeed), randomOfMagnitude(maxSpeed));
      const isInfected = hasOcurred(infectedShareAtStart);
      const personState = isInfected ? State.Infected : State.Healthy;
      const personSimulation = new PersonSimulation(i, this.dimensions, position, speed, personState);
      this.personSimulations.push(personSimulation);
    }
  }

  update() {
    this.timeTicksElapsed++;
    if (this.timeTicksElapsed % timeTicksPerDay == 0) {
      console.log(`${this.timeTicksElapsed / timeTicksPerDay} days elapsed...`);
    }
    this.personSimulations.forEach(personSimulation => {
      personSimulation.update();
    });
    this.findEncountersAndUpdate();
    this.updateStatistics();
  }

  start() {
    this.interval = setInterval(() => {
      worldSimulation.update();
    }, 100);
  }

  pause() {
    clearInterval(this.interval);
    this.interval = null;
  }

  stop() {
    this.pause();
    this.populate(this.populationSize);
    this.timeTicksElapsed = 0;
    this.statistics = new Statistics();
  }

  updateStatistics() {
    const currentDay = Math.ceil(this.timeTicksElapsed / timeTicksPerDay);
    const statisticsForPreviousDayIsMissing = currentDay > this.statistics.getLatestDay() + 1;

    //FIXME: We seem to be taking also the statistics for first tick of the current day into account here, instead we
    //should count only the prevoius day
    if (statisticsForPreviousDayIsMissing) {
      const groupedByState: Dictionary<Array<PersonSimulation>> = _.groupBy(this.personSimulations, 'state');

      //TODO: Any way to reduce the repetition?
      const dayMetrics = {
        healthy: (groupedByState[State.Healthy] || []).length,
        exposed: (groupedByState[State.Exposed] || []).length,
        infected: (groupedByState[State.Infected] || []).length,
        contagious: (groupedByState[State.Contagious] || []).length,
        accute: (groupedByState[State.Accute] || []).length,
        intensiveCare: (groupedByState[State.IntensiveCare] || []).length,
        immune: (groupedByState[State.Immune] || []).length,
        dead: (groupedByState[State.Dead] || []).length,
        cumulativeInfected: this.personSimulations.filter(person => person.wasInfected).length //TODO: This could be accumulated in Statistics over time, no need for a field on person?
      };
      this.statistics.appendDayMetrics(dayMetrics);
    }
  }

  findEncountersAndUpdate() {
    this.getSubworlds().forEach(ySubworlds => {
      ySubworlds.forEach(subworld => {
        this.findEncountersBetweenPersonsAndUpdate(subworld);
      });
    });
  }

  //TODO: Extract the approximate collision detection algorithm into a separate module?
  getSubworlds(): Array<Array<Array<PersonSimulation>>> {
    const sections = _.range(0, sectionsNumber, 1);
    const subWorlds: Array<Array<Array<PersonSimulation>>> = sections.map(() =>
      sections.map(_ => [])
    );
    this.personSimulations.forEach(personSimulation => {
      const subworldPosition = this.getSubworldPosition(personSimulation);
      subWorlds[subworldPosition.x][subworldPosition.y].push(personSimulation);
    });
    return subWorlds;
  }

  getSubworldPosition(personSimulation: PersonSimulation): Vector {
    const xStep = worldDimensions.width / sectionsNumber;
    const yStep = worldDimensions.height / sectionsNumber;

    const subWorldXIndex = Math.min(Math.floor(Math.max(personSimulation.position.x, 0) / xStep), sectionsNumber - 1);
    const subWorldYIndex = Math.min(Math.floor(Math.max(personSimulation.position.y, 0) / yStep), sectionsNumber - 1);

    return new Vector(subWorldXIndex, subWorldYIndex);
  }

  findEncountersBetweenPersonsAndUpdate(personSimulations: Array<PersonSimulation>): void {
    for (let personSimulation of personSimulations) {
      for (let otherPersonSimulation of personSimulations) {
        if ((distance(personSimulation.position, otherPersonSimulation.position) <= interactionRange) && (otherPersonSimulation !== personSimulation)) {
          //console.log(`Person ${personSimulation.id} encountered person ${otherPersonSimulation.id}`);
          personSimulation.onEncounterWith(otherPersonSimulation);
          otherPersonSimulation.onEncounterWith(personSimulation);
        }
      }
    }
  }

  getWorld(): World {
    const persons = this.personSimulations.map(personSimulation => personSimulation.getPerson());
    return new World(persons, this.statistics);
  }
}

const worldSimulation = new WorldSimulation(worldDimensions);
worldSimulation.populate(500);

export default worldSimulation;